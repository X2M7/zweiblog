#!/usr/bin/env python3
"""Updater regressions: simulated Docker, real tar and child-process fixtures.

Run: python3 -m unittest discover -s scripts -p 'test_zweiblog_update.py' -v
No sudo, containers, Docker images, real deployment directories or network are used.
"""

import contextlib
import copy
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    "zweiblog_update", Path(__file__).with_name("zweiblog-update.py"))
update = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(update)

TCR = update.REPOS["1"]
A, B, C, M, N = ["sha256:" + letter * 64 for letter in "abcde"]


def image(iid, version, repo=TCR):
    return {
        "Id": iid, "Architecture": "amd64", "Os": "linux",
        "RepoTags": [repo + ":" + version],
        "RepoDigests": [repo + "@" + iid],
        "Config": {
            "Env": ["ZWEI_BLOG_VERSION=" + version],
            "Labels": {
                "org.opencontainers.image.source": "https://github.com/X2M7/zweiblog",
                "org.opencontainers.image.revision": "f" * 40,
            },
        },
    }


class FakeDocker:
    """Stateful fake for the executable boundary, including tar validation."""

    def __init__(self, compose_dir, data_dir):
        self.compose_dir, self.data_dir = compose_dir, data_dir
        self.config_file = compose_dir / "docker-compose.yml"
        self.config_file.write_text("services: fixture\n")
        self.env_file = compose_dir / ".env"
        self.env_file.write_text("# deployment\nZWEIBLOG_IMAGE=" + TCR + ":v1.0.6\nKEEP=unchanged\n")
        self.images = {A: image(A, "v1.0.6"), B: image(B, "v1.0.9"),
                       C: image(C, "v1.0.5"), M: image(M, "8.0", "mongo")}
        self.calls = []
        self.fail_backup = False
        self.fail_validation = False
        self.fail_pull = False
        self.fail_up_image = None
        self.fail_after_replacement_creation = False
        self.fail_start_app = False
        self.config_hash_drift = False
        self.unhealthy_images = set()
        self.hardcoded_image = False
        self.side_effect_config = False
        self.stop_mongo_exit = 0
        self.sequence = 0
        self.before_inspect = None
        self.before_remove = None
        self.after_archive = None
        self.app_mounts = [
            {"Type": "bind", "Source": str(data_dir / source), "Destination": destination, "RW": True}
            for source, destination in (
                ("data/static", "/app/static"), ("log", "/var/log"),
                ("caddy/config", "/home/zweiblog/.config/caddy"),
                ("caddy/data", "/home/zweiblog/.local/share/caddy"))
        ]
        self.mongo_mounts = [{"Type": "bind", "Source": str(data_dir / "data/mongo"),
                              "Destination": "/data/db", "RW": True}]
        for mount in self.app_mounts + self.mongo_mounts:
            Path(mount["Source"]).mkdir(parents=True, exist_ok=True)
        (data_dir / "data/mongo/content").write_bytes(b"irreplaceable database fixture")
        self.containers = {
            "app-original": self.container("app-original", A, "zweiblog", self.app_mounts),
            "mongo-original": self.container("mongo-original", M, "mongo", self.mongo_mounts),
        }

    def container(self, cid, iid, service, mounts, running=True):
        return {
            "Id": cid, "Name": "/docker-compose-" + service + "-1",
            "Image": iid, "Mounts": copy.deepcopy(mounts),
            "Config": {
                "Image": self.images[iid]["RepoTags"][0],
                "Env": copy.deepcopy(self.images[iid]["Config"]["Env"]),
                "Labels": {
                    "com.docker.compose.service": service,
                    "com.docker.compose.project": "docker-compose",
                    "com.docker.compose.project.working_dir": str(self.compose_dir),
                    "com.docker.compose.project.config_files": str(self.config_file),
                    "com.docker.compose.config-hash": service + "-config-hash",
                    "com.docker.compose.container-number": "1",
                },
            },
            "State": {"Running": running, "Status": "running" if running else "created",
                      "StartedAt": "2026-11-20T00:00:00Z" if running else "0001-01-01T00:00:00Z",
                      "ExitCode": 0, "OOMKilled": False,
                      "Health": {"Status": "healthy"}},
        }

    def resolve(self, ref):
        if ref in self.images:
            return self.images[ref]
        for obj in self.images.values():
            if ref in obj["RepoTags"] + obj["RepoDigests"]:
                return obj
        raise update.UpdateError("fake image not found: " + ref)

    def app(self):
        return next(c for c in self.containers.values()
                    if c["Config"]["Labels"].get("com.docker.compose.service") == "zweiblog")

    def image_ref(self):
        line = next(line for line in self.env_file.read_text().splitlines()
                    if line.startswith("ZWEIBLOG_IMAGE="))
        return line.split("=", 1)[1]

    def run(self, args, *, output=None):
        self.calls.append(list(args))
        command = list(args)
        if command[:2] == ["sudo", "-n"]:
            command = command[2:]
        override = None
        if command and command[0] == "env":
            override = command[1].split("=", 1)[1]
            command = command[2:]
        if command[:2] == ["du", "-sb"]:
            return "1\tfixture\n"
        if command[:3] == ["python3", "-I", "-c"]:
            result = subprocess.run([sys.executable, *command[1:]], capture_output=True, text=True, check=True)
            return result.stdout
        if command and command[0] == "tar":
            if "-czf" in command:
                if self.fail_backup:
                    raise update.UpdateError("simulated backup failure")
                with tarfile.open(fileobj=output, mode="w:gz") as archive:
                    info = tarfile.TarInfo("fixture")
                    payload = b"database archive fixture"
                    info.size = len(payload)
                    archive.addfile(info, io.BytesIO(payload))
                if self.after_archive:
                    self.after_archive()
            else:
                if self.fail_validation:
                    raise update.UpdateError("simulated corrupt archive")
                with tarfile.open(command[-1], "r:gz") as archive:
                    archive.getmembers()
            return ""
        if not command or command[0] != "docker":
            raise AssertionError("unexpected external command: " + repr(args))
        command = command[1:]
        if command and command[0] == "--host=unix:///var/run/docker.sock":
            command = command[1:]
        if command[:2] == ["ps", "-aq"]:
            return "\n".join(self.containers)
        if len(command) >= 2 and command[1] == "inspect":
            kind, _, ref = command
            if self.before_inspect:
                self.before_inspect(kind, ref)
            obj = self.containers[ref] if kind == "container" else self.resolve(ref)
            return json.dumps([obj])
        if command[:3] == ["image", "ls", "-aq"]:
            return "\n".join(self.images)
        if command[:2] == ["container", "rm"]:
            assert len(command) == 3, "force/volume/multiple removals are not allowed"
            obj = self.containers[command[2]]
            if obj["State"]["Running"]:
                raise update.UpdateError("fake daemon refuses running container removal")
            self.containers.pop(command[2])
            return ""
        if command[:2] == ["image", "tag"]:
            self.resolve(command[2])["RepoTags"].append(command[3])
            return ""
        if command[:2] == ["image", "rm"]:
            assert len(command) == 3, "force/multiple removals are not allowed"
            ref = command[2]
            if self.before_remove:
                self.before_remove(ref)
            obj = self.resolve(ref)
            if any(c["Image"] == obj["Id"] for c in self.containers.values()):
                raise update.UpdateError("fake daemon refuses in-use image deletion")
            for key in ("RepoTags", "RepoDigests"):
                if ref in obj[key]:
                    obj[key].remove(ref)
            if not obj["RepoTags"]:
                self.images.pop(obj["Id"])
            return ""
        if command[0] == "pull":
            if self.fail_pull:
                raise update.UpdateError("simulated registry failure")
            self.resolve(command[1])
            return ""
        if command[0] == "stop":
            cid = command[-1]
            self.containers[cid]["State"]["Running"] = False
            self.containers[cid]["State"]["Status"] = "exited"
            if cid == "mongo-original":
                self.containers[cid]["State"]["ExitCode"] = self.stop_mongo_exit
            return ""
        if command[0] == "start":
            if self.fail_start_app and command[-1] == "app-original":
                raise update.UpdateError("simulated app restart failure")
            self.containers[command[-1]]["State"]["Running"] = True
            self.containers[command[-1]]["State"]["Status"] = "running"
            self.containers[command[-1]]["State"]["StartedAt"] = "2026-11-20T00:00:00Z"
            return ""
        if command[0] == "compose":
            if "config" in command:
                if "--hash" in command:
                    service = command[-1]
                    return service + " " + ("drifted" if self.config_hash_drift else service + "-config-hash")
                ref = self.image_ref() if self.hardcoded_image else (override or self.image_ref())
                config = {"services": {"zweiblog": {"image": ref}, "mongo": {"image": "mongo:8.0"}}}
                if override and self.side_effect_config:
                    config["services"]["mongo"]["image"] = "mongo:9"
                return json.dumps(config)
            if "up" in command:
                assert command[-1] == "zweiblog"
                assert "--no-deps" in command and "--no-build" in command
                assert command[command.index("--pull") + 1] == "never"
                ref = override or self.image_ref()
                obj = self.resolve(ref)
                if self.fail_up_image == obj["Id"]:
                    raise update.UpdateError("simulated Compose up failure")
                old = self.app()
                if self.fail_after_replacement_creation:
                    new = self.container("incomplete-replacement", obj["Id"], "zweiblog", old["Mounts"], running=False)
                    new["Name"] = "/" + old["Id"][:12] + "_" + old["Name"].lstrip("/")
                    new["Config"]["Image"] = ref
                    new["Config"]["Labels"]["com.docker.compose.replace"] = "zweiblog-1"
                    self.containers[new["Id"]] = new
                    raise update.UpdateError("simulated failure after replacement creation")
                self.containers.pop(old["Id"])
                self.sequence += 1
                cid = "app-recreated-" + str(self.sequence)
                new = self.container(cid, obj["Id"], "zweiblog", old["Mounts"])
                new["Config"]["Image"] = ref
                if obj["Id"] in self.unhealthy_images:
                    new["State"]["Health"]["Status"] = "unhealthy"
                self.containers[cid] = new
                return ""
        raise AssertionError("unexpected Docker command: " + repr(args))


class FixtureTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="zweiblog-updater-test-")
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.compose = root / "compose"
        self.data = root / "data"
        self.backups = root / "backups"
        self.state = root / "state"
        self.compose.mkdir()
        self.data.mkdir()
        self.fake = FakeDocker(self.compose, self.data)
        self.updater = update.Updater(self.compose, self.data, self.backups, self.state, self.fake)
        self.updater.acquire()
        self.addCleanup(self.updater.lock.close)
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        self.stdout = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        self.stderr = stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
        self.target = {"id": B, "ref": TCR + "@" + B, "version": "v1.0.9"}

    def retained_state(self):
        self.updater.state.update(
            current={"id": A, "ref": TCR + "@" + A, "version": "v1.0.6"},
            previous={"id": B, "ref": TCR + "@" + B, "version": "v1.0.9"})
        self.updater.save()

    def assert_original_healthy(self):
        self.assertEqual(self.fake.app()["Image"], A)
        self.assertTrue(self.fake.app()["State"]["Running"])
        self.assertTrue(self.fake.containers["mongo-original"]["State"]["Running"])
        self.assertEqual((self.data / "data/mongo/content").read_bytes(), b"irreplaceable database fixture")
        self.assertFalse(any("rm" in call for call in self.fake.calls))

    def assert_no_stop(self):
        self.assertFalse(any("stop" in call for call in self.fake.calls))


class PolicyTests(unittest.TestCase):
    def test_repository_recognizes_tags_and_digests_without_prefix_matching(self):
        self.assertEqual(update.repository(TCR + ":v1.0.9"), TCR)
        self.assertEqual(update.repository(TCR + "@" + A), TCR)
        self.assertEqual(update.repository("localhost:5000/a:tag"), "localhost:5000/a")
        self.assertNotIn(update.repository(TCR + "-other:latest"), update.ALLOWED_REPOS)
        self.assertNotIn(update.repository("evil/zweiblog:v1.0.9"), update.ALLOWED_REPOS)

    def test_only_formal_semver_is_accepted(self):
        self.assertEqual(update.version_tuple("v1.0.9"), (1, 0, 9))
        for value in ("latest", "1.0.9", "v01.0.9", "v1.0.9-rc1", "v1.0.9\n", "v1.0.9;id"):
            with self.subTest(value=value), self.assertRaises(update.UpdateError):
                update.version_tuple(value)

    def test_env_replacement_preserves_other_secrets_and_line_endings(self):
        original = b"# fixture\r\nPASSWORD='a#b=$value'\r\n export ZWEIBLOG_IMAGE = old # comment\r\nX=2\r\n"
        actual = update.replace_image_env(original, TCR + "@" + A)
        self.assertEqual(actual, b"# fixture\r\nPASSWORD='a#b=$value'\r\nZWEIBLOG_IMAGE=" +
                         (TCR + "@" + A).encode() + b"\r\nX=2\r\n")

    def test_env_missing_duplicate_and_injection_are_rejected(self):
        for original in (b"OTHER=1\n", b"ZWEIBLOG_IMAGE=a\nexport ZWEIBLOG_IMAGE=b\n"):
            with self.assertRaises(update.UpdateError):
                update.replace_image_env(original, "repo:tag")
        for target in ("repo:tag\nOTHER=evil", "$(touch /tmp/a)", "repo:tag;id"):
            with self.assertRaises(update.UpdateError):
                update.replace_image_env(b"ZWEIBLOG_IMAGE=old\n", target)

    def test_compare_accepts_patch_code_change_and_rejects_migration(self):
        good = {"status": "ahead", "files": [{"filename": "packages/website/view.tsx"}]}
        update.compatible_changes("v1.0.6", "v1.0.9", good)
        for comparison in (
            {"status": "diverged", "files": good["files"]},
            {"status": "ahead", "files": []},
            {"status": "ahead", "files": good["files"] * 300},
            {"status": "ahead", "files": [{"filename": "packages/server/src/scheme/post.ts"}]},
            {"status": "ahead", "files": [{"filename": "archive/old", "previous_filename": "Dockerfile"}]},
        ):
            with self.subTest(comparison=comparison), self.assertRaises(update.UpdateError):
                update.compatible_changes("v1.0.6", "v1.0.9", comparison)
        for version in ("v2.0.0", "v1.1.0", "v1.0.6", "v1.0.5"):
            with self.subTest(version=version), self.assertRaises(update.UpdateError):
                update.compatible_changes("v1.0.6", version, good)

    def test_mount_signature_checks_paths_modes_and_ignores_order(self):
        a = {"Mounts": [{"Type": "bind", "Source": "/data", "Destination": "/app", "RW": True}]}
        b = copy.deepcopy(a)
        self.assertEqual(update.mount_signature(a), update.mount_signature(b))
        b["Mounts"][0]["RW"] = False
        self.assertNotEqual(update.mount_signature(a), update.mount_signature(b))


class RunnerTests(unittest.TestCase):
    def test_interrupt_waits_for_child_completion_and_restores_signal_handlers(self):
        original = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
        completed = []
        def child(args, **kwargs):
            self.assertNotIn("preexec_fn", kwargs)
            self.assertFalse(kwargs.get("start_new_session", False))
            self.assertFalse(kwargs.get("shell", False))
            signal.raise_signal(signal.SIGTERM)
            completed.append(True)
            return subprocess.CompletedProcess(args, 0, b"finished", b"")
        with contextlib.redirect_stderr(io.StringIO()):
            with mock.patch.object(update.subprocess, "run", side_effect=child):
                with self.assertRaises(KeyboardInterrupt):
                    update.Runner().run(["fixture"])
        self.assertEqual(completed, [True])
        self.assertEqual({sig: signal.getsignal(sig) for sig in original}, original)

    def test_command_errors_do_not_include_sensitive_stderr(self):
        result = subprocess.CompletedProcess(["fixture"], 1, b"", b"private database password")
        with mock.patch.object(update.subprocess, "run", return_value=result):
            with self.assertRaises(update.UpdateError) as caught:
                update.Runner().run(["fixture"])
        self.assertNotIn("password", str(caught.exception))

    def test_real_child_preserves_session_isolates_process_group_and_finishes_before_interrupt(self):
        # The signal goes to a separate harness, never the test runner process.
        harness = r'''
import importlib.util, json, os, pathlib, sys
spec = importlib.util.spec_from_file_location("updater", sys.argv[1])
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)
destination = pathlib.Path(sys.argv[2])
child = r"""
import json, os, pathlib, signal, sys, time
result = {"parent_sid": int(sys.argv[3]), "parent_pgid": int(sys.argv[4]),
          "child_sid": os.getsid(0), "child_pgid": os.getpgrp(),
          "child_pid": os.getpid(), "guardian_pid": os.getppid()}
os.kill(int(sys.argv[2]), signal.SIGTERM)
time.sleep(0.1)
result["completed"] = True
pathlib.Path(sys.argv[1]).write_text(json.dumps(result))
"""
try:
    updater.Runner().run([sys.executable, "-c", child, str(destination), str(os.getpid()),
                          str(os.getsid(0)), str(os.getpgrp())])
except KeyboardInterrupt:
    if not destination.is_file():
        raise AssertionError("Runner raised before child completed")
    print(destination.read_text())
else:
    raise AssertionError("Runner lost the interrupt")
'''
        with tempfile.TemporaryDirectory(prefix="zweiblog-runner-signal-") as directory:
            completed = subprocess.run(
                [sys.executable, "-c", harness, str(Path(update.__file__)), str(Path(directory) / "result.json")],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        result = json.loads(completed.stdout)
        self.assertTrue(result["completed"])
        self.assertEqual(result["child_sid"], result["parent_sid"])
        self.assertNotEqual(result["child_pgid"], result["parent_pgid"])
        self.assertEqual(result["child_pgid"], result["guardian_pid"])
        self.assertNotEqual(result["child_pid"], result["guardian_pid"])

    def test_guardian_retains_deployment_lock_after_parent_is_killed(self):
        harness = r'''
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location("updater", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = pathlib.Path(sys.argv[2])
updater = module.Updater(root / "compose", root / "data", root / "backups", root / "state")
updater.acquire()
child = r"""
import pathlib, sys, time
root = pathlib.Path(sys.argv[1])
(root / "ready").touch()
deadline = time.monotonic() + 10
while not (root / "release").exists() and time.monotonic() < deadline:
    time.sleep(0.02)
(root / "done").touch()
"""
updater.runner.run([sys.executable, "-c", child, str(root)])
'''
        with tempfile.TemporaryDirectory(prefix="zweiblog-runner-lock-") as directory:
            root = Path(directory)
            (root / "compose").mkdir()
            (root / "data").mkdir()
            with (root / "stderr").open("w+") as errors:
                process = subprocess.Popen(
                    [sys.executable, "-c", harness, str(Path(update.__file__)), str(root)],
                    stdout=subprocess.DEVNULL, stderr=errors)
                try:
                    deadline = time.monotonic() + 5
                    while not (root / "ready").exists() and time.monotonic() < deadline:
                        if process.poll() is not None:
                            errors.seek(0)
                            self.fail("harness exited before child started: " + errors.read())
                        time.sleep(0.02)
                    self.assertTrue((root / "ready").exists(), "child did not start")
                    process.kill()
                    process.wait(timeout=3)
                    self.assertEqual(process.returncode, -signal.SIGKILL)
                    with (root / "compose/.zweiblog-updater.lock").open("r+") as lock:
                        with self.assertRaises(BlockingIOError):
                            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                        self.assertFalse((root / "done").exists())
                        (root / "release").touch()
                        acquired = False
                        deadline = time.monotonic() + 5
                        while time.monotonic() < deadline:
                            try:
                                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                                acquired = True
                                break
                            except BlockingIOError:
                                time.sleep(0.02)
                        self.assertTrue(acquired, "guardian did not release lock after child completed")
                        self.assertTrue((root / "done").exists())
                finally:
                    (root / "release").touch()
                    if process.poll() is None:
                        process.kill()
                    process.wait(timeout=3)


class ArchiveIntegrationTests(unittest.TestCase):
    def test_real_gnu_tar_backup_preserves_data_and_private_archive_permissions(self):
        class UnprivilegedTarRunner:
            def __init__(self):
                self.calls = []

            def run(self, args, *, output=None):
                self.calls.append(list(args))
                command = list(args)
                if command[:2] == ["sudo", "-n"]:
                    command = command[2:]
                if command[0] != "tar":
                    raise AssertionError("archive test permits only real tar commands")
                return update.Runner().run(command, output=output)

        with tempfile.TemporaryDirectory(prefix="zweiblog-real-archive-") as directory:
            root = Path(directory)
            data = root / "data"
            secrets = data / "secrets"
            secrets.mkdir(parents=True)
            content = data / "database.bin"
            credential = secrets / "mongo-root-password"
            content.write_bytes(b"original database fixture\x00\xff\n")
            credential.write_bytes(b"fixture-only-not-a-real-credential\n")
            credential.chmod(0o600)
            destination = root / "data-and-config.tar.gz"
            runner = UnprivilegedTarRunner()
            updater = update.Updater(root, data, root, root, runner)
            sha = updater.archive(destination, [str(data)])
            self.assertEqual(sha, hashlib.sha256(destination.read_bytes()).hexdigest())
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
            self.assertFalse(Path(str(destination) + ".partial").exists())
            with tarfile.open(destination, "r:gz") as archive:
                for source in (content, credential):
                    member = archive.getmember(str(source).lstrip("/"))
                    with archive.extractfile(member) as stream:
                        self.assertEqual(stream.read(), source.read_bytes())
                    self.assertEqual(member.uid, os.getuid())
                self.assertEqual(archive.getmember(str(credential).lstrip("/")).mode, 0o600)
            self.assertIn("--numeric-owner", runner.calls[0])
            self.assertIn("--acls", runner.calls[0])
            self.assertIn("--xattrs", runner.calls[0])
            self.assertEqual(runner.calls[1], ["tar", "-tzf", str(destination) + ".partial"])


class TransactionTests(FixtureTest):
    def test_success_retains_actual_old_image_and_complete_backup(self):
        original = self.fake.env_file.read_bytes()
        self.assertTrue(self.updater.transaction(self.target))
        self.assertEqual(self.fake.app()["Image"], B)
        self.assertEqual(self.updater.state["current"], self.target)
        self.assertEqual(self.updater.state["previous"]["id"], A)
        self.assertIsNone(self.updater.state["pending"])
        self.assertEqual(self.fake.containers["mongo-original"]["Image"], M)
        backup = next(self.backups.iterdir())
        self.assertEqual((backup / ".env.before").read_bytes(), original)
        self.assertTrue((backup / "BACKUP_OK").is_file())
        self.assertIn(update.digest_file(backup / "data-and-config.tar.gz"), (backup / "BACKUP_OK").read_text())
        self.assertEqual((self.state / "state.json").stat().st_mode & 0o777, 0o600)
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.updater.cleanup()
        self.assertIn(A, self.fake.images)
        self.assertIn(B, self.fake.images)
        self.assertNotIn(C, self.fake.images)
        self.assertIn(M, self.fake.images)

    def test_same_image_does_not_rotate_previous_or_stop_services(self):
        self.retained_state()
        state = copy.deepcopy(self.updater.state)
        target = {"id": A, "ref": TCR + "@" + A, "version": "v1.0.6"}
        self.assertFalse(self.updater.transaction(target))
        self.assertEqual(self.updater.state, state)
        self.assert_no_stop()

    def test_second_update_replaces_previous_and_removes_older_image(self):
        self.updater.transaction(self.target)
        self.fake.images[C] = image(C, "v1.0.10")
        self.updater.transaction({"id": C, "ref": TCR + "@" + C, "version": "v1.0.10"})
        self.updater.cleanup()
        self.assertEqual(self.updater.state["current"]["id"], C)
        self.assertEqual(self.updater.state["previous"]["id"], B)
        self.assertNotIn(A, self.fake.images)

    def test_rollback_swaps_images_without_restoring_database(self):
        self.updater.transaction(self.target)
        (self.data / "data/mongo/content").write_bytes(b"new writes after upgrade")
        previous = copy.deepcopy(self.updater.state["previous"])
        self.updater.transaction(previous)
        self.assertEqual(self.fake.app()["Image"], A)
        self.assertEqual(self.updater.state["previous"]["id"], B)
        self.assertEqual((self.data / "data/mongo/content").read_bytes(), b"new writes after upgrade")

    def test_backup_failure_restores_original_services_without_cleaning(self):
        self.fake.fail_backup = True
        with self.assertRaisesRegex(update.UpdateError, "backup failure"):
            self.updater.transaction(self.target)
        self.assert_original_healthy()
        self.assertIsNone(self.updater.state["pending"])
        self.assertFalse(list(self.backups.glob("*/BACKUP_OK")))

    def test_archive_validation_failure_restores_services(self):
        self.fake.fail_validation = True
        with self.assertRaisesRegex(update.UpdateError, "corrupt archive"):
            self.updater.transaction(self.target)
        self.assert_original_healthy()
        self.assertFalse(list(self.backups.glob("*/BACKUP_OK")))

    def test_nonzero_mongo_stop_exit_aborts_before_archive(self):
        self.fake.stop_mongo_exit = 137
        with self.assertRaises(update.UpdateError):
            self.updater.transaction(self.target)
        self.assert_original_healthy()
        self.assertFalse(list(self.backups.glob("*/data-and-config.tar.gz")))

    def test_unhealthy_new_container_rolls_back_and_preserves_retention_state(self):
        self.retained_state()
        before = copy.deepcopy(self.updater.state)
        self.fake.unhealthy_images.add(B)
        with self.assertRaisesRegex(update.UpdateError, "unhealthy"):
            self.updater.transaction(self.target)
        self.assert_original_healthy()
        self.assertEqual(self.updater.state["current"]["id"], before["current"]["id"])
        self.assertEqual(self.updater.state["previous"], before["previous"])

    def test_compose_failure_rolls_back(self):
        self.fake.fail_up_image = B
        with self.assertRaisesRegex(update.UpdateError, "Compose up failure"):
            self.updater.transaction(self.target)
        self.assert_original_healthy()

    def test_compose_partial_recreate_removes_only_never_started_replacement(self):
        self.fake.fail_after_replacement_creation = True
        with self.assertRaisesRegex(update.UpdateError, "failure after replacement creation"):
            self.updater.transaction(self.target)
        self.assertEqual(self.fake.app()["Id"], "app-original")
        self.assertTrue(self.fake.app()["State"]["Running"])
        self.assertTrue(self.fake.containers["mongo-original"]["State"]["Running"])
        self.assertIsNone(self.updater.state["pending"])
        self.assertEqual((self.data / "data/mongo/content").read_bytes(), b"irreplaceable database fixture")
        removals = [call for call in self.fake.calls if "rm" in call]
        self.assertEqual(removals, [["sudo", "-n", "docker", "--host=unix:///var/run/docker.sock",
                                    "container", "rm", "incomplete-replacement"]])

    def test_recovery_preserves_unknown_or_started_replacement_containers(self):
        self.fake.fail_after_replacement_creation = True
        with mock.patch.object(self.updater, "remove_incomplete_replacement", side_effect=KeyboardInterrupt):
            with self.assertRaises(update.UpdateError):
                self.updater.transaction(self.target)
        pending = self.updater.state["pending"]
        original = self.fake.containers["app-original"]
        candidate = copy.deepcopy(self.fake.containers["incomplete-replacement"])
        mutations = {
            "name": lambda c: c.update(Name="/unrelated-container"),
            "image": lambda c: c.update(Image=C),
            "reference": lambda c: c["Config"].update(Image=TCR + ":unrelated"),
            "project": lambda c: c["Config"]["Labels"].update({"com.docker.compose.project": "another"}),
            "replace_label": lambda c: c["Config"]["Labels"].pop("com.docker.compose.replace"),
            "mount": lambda c: c["Mounts"][0].update(Source="/unknown-data"),
            "running": lambda c: c["State"].update(Running=True),
            "exited": lambda c: c["State"].update(Status="exited"),
            "previously_started": lambda c: c["State"].update(StartedAt="2026-11-20T01:00:00Z"),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                changed = copy.deepcopy(candidate)
                mutate(changed)
                self.fake.containers[changed["Id"]] = changed
                with self.assertRaises(update.UpdateError):
                    self.updater.remove_incomplete_replacement(pending, original)
                self.assertIn(changed["Id"], self.fake.containers)
        self.assertFalse(any("rm" in call for call in self.fake.calls))
        self.fake.containers[candidate["Id"]] = candidate
        self.updater.lock.close()
        resumed = update.Updater(self.compose, self.data, self.backups, self.state, self.fake)
        resumed.acquire()
        self.addCleanup(resumed.lock.close)
        resumed.restore()
        self.assertIsNone(resumed.state["pending"])

    def test_replacement_started_during_removal_is_not_forcibly_removed(self):
        self.fake.fail_after_replacement_creation = True
        real_docker = self.updater.docker
        def start_before_remove(*args):
            if args[:2] == ("container", "rm"):
                self.fake.containers[args[2]]["State"]["Running"] = True
            return real_docker(*args)
        with mock.patch.object(self.updater, "docker", side_effect=start_before_remove):
            with self.assertRaises(update.UpdateError):
                self.updater.transaction(self.target)
        self.assertIn("incomplete-replacement", self.fake.containers)
        self.assertIsNotNone(self.updater.state["pending"])
        self.assertFalse(self.fake.containers["app-original"]["State"]["Running"])

    def test_bad_config_rejected_before_downtime(self):
        for attr in ("hardcoded_image", "side_effect_config"):
            with self.subTest(attr=attr):
                setattr(self.fake, attr, True)
                with self.assertRaises(update.UpdateError):
                    self.updater.transaction(self.target)
                setattr(self.fake, attr, False)
        self.assert_no_stop()

    def test_environment_drift_rejected_before_downtime(self):
        self.fake.env_file.write_text("ZWEIBLOG_IMAGE=" + TCR + ":v1.0.5\n")
        with self.assertRaises(update.UpdateError):
            self.updater.transaction(self.target)
        self.assert_no_stop()

    def test_running_config_hash_drift_rejected_before_downtime(self):
        self.fake.config_hash_drift = True
        with self.assertRaises(update.UpdateError):
            self.updater.transaction(self.target)
        self.assert_no_stop()

    def test_shared_writable_data_mount_rejected_before_downtime(self):
        self.fake.containers["other"] = self.fake.container("other", C, "other", self.fake.app_mounts)
        with self.assertRaises(update.UpdateError):
            self.updater.transaction(self.target)
        self.assert_no_stop()

    def test_shared_writable_external_configdb_rejected_before_downtime(self):
        source = Path(self.tmp.name) / "external-configdb"
        source.mkdir()
        mount = {"Type": "volume", "Source": str(source), "Destination": "/data/configdb", "RW": True}
        self.fake.containers["mongo-original"]["Mounts"].append(mount)
        self.fake.containers["other"] = self.fake.container("other", C, "other", [mount])
        with self.assertRaisesRegex(update.UpdateError, "另一个容器也可写入"):
            self.updater.transaction(self.target)
        self.assert_no_stop()

    def test_shared_readonly_external_configdb_does_not_block_backup(self):
        source = Path(self.tmp.name) / "external-configdb"
        source.mkdir()
        mount = {"Type": "volume", "Source": str(source), "Destination": "/data/configdb", "RW": True}
        self.fake.containers["mongo-original"]["Mounts"].append(mount)
        reader_mount = dict(mount, RW=False)
        self.fake.containers["other"] = self.fake.container("other", C, "other", [reader_mount])
        self.assertTrue(self.updater.transaction(self.target))

    def test_uncovered_data_symlink_is_rejected_before_downtime(self):
        external = Path(self.tmp.name) / "external-gallery"
        external.mkdir()
        (external / "unique-photo").write_bytes(b"must not be omitted from a complete backup")
        (self.data / "data/static/gallery").symlink_to(external, target_is_directory=True)
        with self.assertRaisesRegex(update.UpdateError, "符号链接"):
            self.updater.transaction(self.target)
        self.assert_no_stop()
        self.assertFalse(list(self.backups.glob("*/BACKUP_OK")))

    def test_symlink_introduced_after_preflight_aborts_backup_and_restores_services(self):
        external = Path(self.tmp.name) / "external-gallery"
        external.mkdir()
        real_docker = self.updater.docker
        def introduce_link_after_stop(*args):
            result = real_docker(*args)
            if args[0] == "stop" and args[-1] == "mongo-original":
                (self.data / "data/static/gallery").symlink_to(external, target_is_directory=True)
            return result
        with mock.patch.object(self.updater, "docker", side_effect=introduce_link_after_stop):
            with self.assertRaisesRegex(update.UpdateError, "符号链接"):
                self.updater.transaction(self.target)
        self.assert_original_healthy()
        self.assertIsNone(self.updater.state["pending"])
        self.assertFalse(list(self.backups.glob("*/BACKUP_OK")))
        self.assertFalse(list(self.backups.glob("*/data-and-config.tar.gz")))

    def test_pull_failure_never_stops_services(self):
        self.fake.fail_pull = True
        comparison = {"status": "ahead", "files": [{"filename": "README.md"}]}
        with mock.patch.object(self.updater, "github", return_value=comparison):
            with self.assertRaisesRegex(update.UpdateError, "registry failure"):
                self.updater.pull_release(TCR, {"tag_name": "v1.0.9"}, "v1.0.6")
        self.assert_no_stop()

    def test_pull_verifies_commit_version_and_digest(self):
        def github(path):
            if path.startswith("/compare/"):
                return {"status": "ahead", "files": [{"filename": "README.md"}]}
            return {"sha": "f" * 40}
        with mock.patch.object(self.updater, "github", side_effect=github):
            target = self.updater.pull_release(TCR, {"tag_name": "v1.0.9"}, "v1.0.6")
            self.assertEqual(target, self.target)
            self.fake.images[B]["Config"]["Labels"]["org.opencontainers.image.revision"] = "0" * 40
            with self.assertRaises(update.UpdateError):
                self.updater.pull_release(TCR, {"tag_name": "v1.0.9"}, "v1.0.6")
        self.assert_no_stop()

    def test_architecture_mismatch_refused_before_downtime(self):
        self.fake.images[B]["Architecture"] = "arm64"
        with self.assertRaises(update.UpdateError):
            self.updater.transaction(self.target)
        self.assert_no_stop()

    def test_low_disk_space_refused_before_downtime(self):
        usage = mock.Mock(free=512)
        with mock.patch.object(update.shutil, "disk_usage", return_value=usage):
            with self.assertRaises(update.UpdateError):
                self.updater.transaction(self.target)
        self.assert_no_stop()

    def test_unlabelled_other_container_does_not_break_discovery(self):
        self.fake.containers["unlabelled"] = self.fake.container("unlabelled", C, "other", [])
        self.fake.containers["unlabelled"]["Config"]["Labels"] = None
        app, mongo, _ = self.updater.discover()
        self.assertEqual(app["Id"], "app-original")
        self.assertEqual(mongo["Id"], "mongo-original")

    def test_env_edited_during_backup_is_preserved_and_original_services_restarted(self):
        original = self.fake.env_file.read_bytes()
        changed = original + b"USER_EDIT=preserve\n"
        self.fake.after_archive = lambda: self.fake.env_file.write_bytes(changed)
        with self.assertRaises(update.UpdateError):
            self.updater.transaction(self.target)
        self.assert_original_healthy()
        self.assertEqual(self.fake.env_file.read_bytes(), changed)
        self.assertIsNotNone(self.updater.state["pending"])
        self.fake.env_file.write_bytes(original)
        self.updater.restore()
        self.assertIsNone(self.updater.state["pending"])

    def test_compose_edited_during_backup_is_preserved_and_original_services_restarted(self):
        self.fake.after_archive = lambda: self.fake.config_file.write_text("user configuration edit\n")
        with self.assertRaises(update.UpdateError):
            self.updater.transaction(self.target)
        self.assert_original_healthy()
        self.assertEqual(self.fake.config_file.read_text(), "user configuration edit\n")
        self.assertIsNotNone(self.updater.state["pending"])

    def test_commit_save_failure_restores_previous_retention_and_services(self):
        self.retained_state()
        prior = copy.deepcopy(self.updater.state)
        real_save = self.updater.save
        failed = [False]
        def fail_commit_once():
            if (not failed[0] and self.updater.state["current"] == self.target
                    and self.updater.state["pending"] is None):
                failed[0] = True
                raise OSError("simulated journal commit failure")
            real_save()
        with mock.patch.object(self.updater, "save", side_effect=fail_commit_once):
            with self.assertRaisesRegex(OSError, "journal commit failure"):
                self.updater.transaction(self.target)
        self.assert_original_healthy()
        self.assertEqual(self.updater.state["current"]["id"], A)
        self.assertEqual(self.updater.state["previous"], prior["previous"])
        saved = json.loads((self.state / "state.json").read_text())
        self.assertEqual(saved["previous"], prior["previous"])
        self.assertIsNone(saved["pending"])

    def test_interrupted_recovery_can_resume_from_disk_journal(self):
        self.fake.fail_backup = True
        self.fake.fail_start_app = True
        with self.assertRaises(update.UpdateError):
            self.updater.transaction(self.target)
        self.assertIsNotNone(self.updater.state["pending"])
        with self.assertRaises(update.UpdateError):
            self.updater.cleanup()
        self.updater.lock.close()
        resumed = update.Updater(self.compose, self.data, self.backups, self.state, self.fake)
        resumed.acquire()
        self.addCleanup(resumed.lock.close)
        self.fake.fail_start_app = False
        resumed.restore()
        self.assertIsNone(resumed.state["pending"])
        self.assert_original_healthy()

    def test_failed_recovery_commit_keeps_pending_and_is_idempotent_after_restart(self):
        self.fake.fail_backup = True
        self.fake.fail_start_app = True
        with self.assertRaises(update.UpdateError):
            self.updater.transaction(self.target)
        self.fake.fail_start_app = False
        with mock.patch.object(self.updater, "save", side_effect=OSError("recovery commit failed")):
            with self.assertRaisesRegex(OSError, "recovery commit failed"):
                self.updater.restore()
        self.assertIsNotNone(self.updater.state["pending"])
        self.updater.lock.close()
        resumed = update.Updater(self.compose, self.data, self.backups, self.state, self.fake)
        resumed.acquire()
        self.addCleanup(resumed.lock.close)
        resumed.restore()
        self.assertIsNone(resumed.state["pending"])
        self.assert_original_healthy()


class CleanupTests(FixtureTest):
    def test_cleanup_without_previous_record_refuses_to_guess(self):
        with self.assertRaises(update.UpdateError):
            self.updater.cleanup()
        self.assertFalse(any("rm" in call for call in self.fake.calls))

    def test_cleanup_protects_current_previous_and_stopped_container_images(self):
        self.retained_state()
        self.fake.containers["stopped-other"] = self.fake.container("stopped-other", C, "other", [], running=False)
        self.updater.cleanup()
        self.assertEqual(set(self.fake.images), {A, B, C, M})

    def test_cleanup_preserves_unknown_alias_and_untagged_images(self):
        self.retained_state()
        self.fake.images[C]["RepoTags"].append("unrelated/project:saved")
        self.fake.images[N] = image(N, "v0.9.0")
        self.fake.images[N]["RepoTags"] = []
        self.fake.images[N]["RepoDigests"] = []
        self.updater.cleanup()
        self.assertIn(C, self.fake.images)
        self.assertIn(N, self.fake.images)

    def test_cleanup_refuses_external_deployment_drift(self):
        self.retained_state()
        self.updater.state["current"]["id"] = C
        with self.assertRaises(update.UpdateError):
            self.updater.cleanup()
        self.assertFalse(any("rm" in call for call in self.fake.calls))

    def test_cleanup_never_uses_force_or_broad_prune(self):
        self.retained_state()
        self.updater.cleanup()
        removals = [call for call in self.fake.calls if "rm" in call]
        self.assertTrue(removals)
        for call in self.fake.calls:
            self.assertNotIn("prune", call)
            self.assertNotIn("--force", call)
            self.assertNotIn("-f", call)
        self.assertNotIn(C, self.fake.images)
        self.assertEqual(set(self.fake.images), {A, B, M})

    def test_retargeted_reference_stops_cleanup_without_removing_new_target(self):
        self.retained_state()
        tag = TCR + ":v1.0.5"
        def retarget(kind, ref):
            if kind == "image" and ref == tag:
                self.fake.images[C]["RepoTags"].remove(tag)
                self.fake.images[A]["RepoTags"].append(tag)
                self.fake.before_inspect = None
        self.fake.before_inspect = retarget
        with self.assertRaises(update.UpdateError):
            self.updater.cleanup()
        self.assertIn(A, self.fake.images)
        self.assertIn(C, self.fake.images)
        self.assertFalse(any("rm" in call for call in self.fake.calls))

    def test_cleanup_failure_does_not_undo_successful_update(self):
        self.updater.transaction(self.target)
        def fail_removal(ref):
            raise update.UpdateError("simulated deletion failure")
        self.fake.before_remove = fail_removal
        with self.assertRaises(update.UpdateError):
            self.updater.cleanup()
        self.assertEqual(self.fake.app()["Image"], B)
        self.assertEqual(self.updater.state["current"]["id"], B)
        self.assertIsNone(self.updater.state["pending"])


class LocalStateTests(FixtureTest):
    def test_lock_is_per_deployment_even_with_different_state_directory(self):
        other = update.Updater(self.compose, self.data, self.backups,
                               self.state.parent / "different-state", self.fake)
        try:
            with self.assertRaises(update.UpdateError):
                other.acquire()
        finally:
            if other.lock:
                other.lock.close()

    def test_malformed_state_fails_closed(self):
        self.updater.lock.close()
        (self.state / "state.json").write_text('{"format": 1}')
        other = update.Updater(self.compose, self.data, self.backups, self.state, self.fake)
        try:
            with self.assertRaises(update.UpdateError):
                other.acquire()
        finally:
            if other.lock:
                other.lock.close()

    def test_atomic_write_refuses_symlink_without_modifying_target(self):
        target = self.state / "target"
        target.write_bytes(b"original")
        link = self.state / "link"
        link.symlink_to(target)
        with self.assertRaises(update.UpdateError):
            update.atomic_write(link, b"modified")
        self.assertEqual(target.read_bytes(), b"original")


class SymlinkCoverageTests(unittest.TestCase):
    class ScannerRunner:
        def run(self, args):
            # Exercise the real scanner as the current user in temporary fixtures.
            if args[:5] != ["sudo", "-n", "python3", "-I", "-c"]:
                raise AssertionError("unexpected scanner command")
            result = subprocess.run([sys.executable, "-I", "-c", *args[5:]],
                                    capture_output=True, text=True, check=True)
            return result.stdout

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="zweiblog-link-coverage-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.data = self.root / "data"
        self.data.mkdir()
        self.external = self.root / "data-outside"
        self.external.mkdir()
        self.runner = self.ScannerRunner()

    def test_internal_relative_absolute_and_chained_links_are_covered(self):
        target = self.data / "images"
        target.mkdir()
        (target / "original.png").write_bytes(b"irreplaceable fixture")
        (self.data / "relative").symlink_to("images", target_is_directory=True)
        (self.data / "absolute").symlink_to(target, target_is_directory=True)
        (self.data / "chain").symlink_to("relative", target_is_directory=True)
        (target / "parent-link").symlink_to("../images/original.png")
        update.check_archive_symlinks(self.runner, [self.data])

    def test_external_directory_target_is_rejected_even_with_shared_path_prefix(self):
        (self.external / "original.png").write_bytes(b"outside image")
        (self.data / "gallery").symlink_to(self.external, target_is_directory=True)
        with self.assertRaisesRegex(update.UpdateError, "gallery"):
            update.check_archive_symlinks(self.runner, [self.data])

    def test_explicitly_archived_directory_and_file_targets_are_covered(self):
        secret = self.root / "mongo-app-uri"
        secret.write_bytes(b"fixture-only-credential")
        (self.data / "gallery").symlink_to(self.external, target_is_directory=True)
        (self.data / "secret").symlink_to(secret)
        update.check_archive_symlinks(self.runner, [self.data, self.external, secret])

    def test_external_link_chain_cannot_hide_an_uncovered_target(self):
        (self.data / "first").symlink_to("second", target_is_directory=True)
        (self.data / "second").symlink_to(self.external, target_is_directory=True)
        with self.assertRaises(update.UpdateError):
            update.check_archive_symlinks(self.runner, [self.data])

    def test_symlink_source_is_rejected_even_when_its_target_is_also_archived(self):
        target = self.external / "compose.yml"
        target.write_text("services: {}\n")
        link = self.root / "compose.yml"
        link.symlink_to(target)
        with self.assertRaisesRegex(update.UpdateError, "compose.yml"):
            update.check_archive_symlinks(self.runner, [self.data, target, link])

    def test_source_with_symlink_parent_cannot_claim_canonical_target_coverage(self):
        target = self.external / "compose.yml"
        target.write_text("services: {}\n")
        alias = self.root / "config-alias"
        alias.symlink_to(self.external, target_is_directory=True)
        with self.assertRaisesRegex(update.UpdateError, "config-alias"):
            update.check_archive_symlinks(self.runner, [self.data, alias / "compose.yml"])

    def test_link_cannot_leave_archive_then_return_to_an_internal_final_target(self):
        target = self.data / "target"
        target.write_bytes(b"restorable content")
        back = self.external / "back"
        back.symlink_to(target)
        (self.data / "via-external").symlink_to(back)
        with self.assertRaisesRegex(update.UpdateError, "via-external"):
            update.check_archive_symlinks(self.runner, [self.data])

    def test_external_component_before_dotdot_cannot_be_hidden_by_normalization(self):
        nested = self.data / "nested"
        nested.mkdir()
        actual = self.data / "data"
        actual.mkdir()
        (actual / "target").write_bytes(b"internal content")
        bridge = self.root / "bridge"
        bridge.symlink_to(nested, target_is_directory=True)
        # Both normalized lexical path and final realpath are inside data, but
        # the external bridge needed to resolve the link is absent from tar.
        raw_target = str(bridge) + "/../data/target"
        self.assertTrue(Path(os.path.normpath(raw_target)).is_relative_to(self.data))
        self.assertTrue(Path(raw_target).resolve(strict=True).is_relative_to(self.data))
        (self.data / "via-bridge").symlink_to(raw_target)
        with self.assertRaisesRegex(update.UpdateError, "via-bridge"):
            update.check_archive_symlinks(self.runner, [self.data])

    def test_link_requires_external_dotdot_directory_to_be_archived_too(self):
        (self.data / "target").write_bytes(b"internal content")
        (self.data / "via-directory").symlink_to(str(self.external) + "/../data/target")
        with self.assertRaisesRegex(update.UpdateError, "via-directory"):
            update.check_archive_symlinks(self.runner, [self.data])

    def test_dangling_and_cyclic_links_fail_closed(self):
        link = self.data / "invalid"
        for target in ("missing", "invalid"):
            with self.subTest(target=target):
                link.symlink_to(target)
                try:
                    with self.assertRaisesRegex(update.UpdateError, "invalid"):
                        update.check_archive_symlinks(self.runner, [self.data])
                finally:
                    link.unlink()

    @unittest.skipIf(os.geteuid() == 0, "unreadable-directory fixture needs an unprivileged user")
    def test_unreadable_directory_prevents_claiming_complete_scan(self):
        restricted = self.data / "restricted"
        restricted.mkdir()
        restricted.chmod(0)
        try:
            with self.assertRaisesRegex(update.UpdateError, "restricted"):
                update.check_archive_symlinks(self.runner, [self.data])
        finally:
            restricted.chmod(0o700)

    def test_failed_command_and_invalid_responses_fail_closed(self):
        runner = mock.Mock()
        runner.run.side_effect = update.UpdateError("sudo denied")
        with self.assertRaises(update.UpdateError):
            update.check_archive_symlinks(runner, [self.data])
        runner.run.side_effect = None
        for response in ("not-json", "[]", "{}", '{"ok": "true"}'):
            with self.subTest(response=response):
                runner.run.return_value = response
                with self.assertRaises(update.UpdateError):
                    update.check_archive_symlinks(runner, [self.data])


if __name__ == "__main__":
    unittest.main()
