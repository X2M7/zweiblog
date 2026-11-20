#!/usr/bin/env python3
"""Interactive updater for an existing Linux ZweiBlog Compose deployment.

Python 3.9+, standard library only. Never run with sudo: this program invokes
sudo for Docker, archive creation, size checks and read-only backup path checks.
No Docker prune, volume removal, or git pull.
"""

import argparse
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import uuid


REPOS = {
    "1": "ccr.ccs.tencentyun.com/x2m7/zweiblog",
    "2": "ghcr.io/x2m7/zweiblog",
}
ALLOWED_REPOS = set(REPOS.values()) | {"zweiblog-local-rollback", "zweiblog"}
API = "https://api.github.com/repos/X2M7/zweiblog"
IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}\Z")
VERSION = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")
ENV_IMAGE = re.compile(rb"^[ \t]*(?:export[ \t]+)?ZWEIBLOG_IMAGE[ \t]*=", re.M)
CRITICAL_PATHS = (
    "docker-compose/", "Dockerfile", "entrypoint.sh", "scripts/start.js",
    # Backend changes can alter stored data even outside schema/init files.
    "packages/server/src/",
)


class UpdateError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise UpdateError(message)


def safe_text(value):
    return "".join(c for c in str(value) if c in "\n\t" or c.isprintable())


def version_tuple(version):
    require(bool(VERSION.fullmatch(version)), "版本必须是正式版 vX.Y.Z。")
    return tuple(map(int, version[1:].split(".")))


def repository(ref):
    if "@" in ref:
        return ref.split("@", 1)[0]
    last = ref.rsplit("/", 1)[-1]
    return ref.rsplit(":", 1)[0] if ":" in last else ref


def image_version(obj):
    env = obj.get("Config", {}).get("Env", []) or []
    values = [s.partition("=")[2] for s in env if s.startswith("ZWEI_BLOG_VERSION=")]
    require(len(values) == 1, "无法确认镜像中的应用版本。")
    version = values[0]
    if not version.startswith("v"):
        version = "v" + version
    version_tuple(version)
    return version


def replace_image_env(original, image):
    require("\n" not in image and re.fullmatch(r"[a-zA-Z0-9_.:/@-]+", image), "镜像引用无效。")
    require(len(ENV_IMAGE.findall(original)) == 1,
            ".env 必须且只能有一条 ZWEIBLOG_IMAGE= 配置；请先整理配置。")
    return re.sub(rb"^[ \t]*(?:export[ \t]+)?ZWEIBLOG_IMAGE[ \t]*=[^\r\n]*",
                  b"ZWEIBLOG_IMAGE=" + image.encode("ascii"), original, flags=re.M)


def atomic_write(path, data, mode=0o600):
    path = Path(path)
    require(not path.is_symlink(), f"拒绝覆盖符号链接：{path}")
    fd, name = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        dfd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def digest_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


ARCHIVE_SYMLINK_CHECK = r'''
import json, os, stat, sys
from collections import deque
from pathlib import Path

class UnsafePath(Exception):
    def __init__(self, path, reason):
        self.path, self.reason = path, reason

roots = []
active_path = ""
stack = []

def covered(path):
    return any(path == root or (directory and os.path.commonpath((root, path)) == root)
               for root, directory in roots)

def resolve_covered_link(path):
    # Validate every intermediate link, not only the final realpath. A link
    # outside the archive can point back inside and still be missing on restore.
    components = deque(path.split(os.sep))
    current = os.sep
    links = 0
    while components:
        part = components.popleft()
        if not part or part == ".":
            continue
        if part == "..":
            current = os.path.dirname(current)
            continue
        candidate = os.path.join(current, part)
        if not covered(candidate) and not any(os.path.commonpath((root, candidate)) == candidate
                                             for root, _ in roots):
            raise UnsafePath(path, "uncovered-link-path-component")
        info = os.lstat(candidate)
        if stat.S_ISLNK(info.st_mode):
            links += 1
            if links > 40 or not covered(candidate):
                raise UnsafePath(path, "uncovered-or-cyclic-link-chain")
            target = os.readlink(candidate)
            components.extendleft(reversed(target.split(os.sep)))
            if os.path.isabs(target):
                current = os.sep
        else:
            current = candidate
    if not covered(current):
        raise UnsafePath(path, "uncovered-symlink-target")

try:
    if not sys.argv[1:]:
        raise UnsafePath("", "empty-sources")
    for source in sys.argv[1:]:
        active_path = source
        if not os.path.isabs(source):
            raise UnsafePath(source, "relative-source")
        info = os.lstat(source)
        if stat.S_ISLNK(info.st_mode):
            raise UnsafePath(source, "source-is-symlink")
        resolved = str(Path(source).resolve(strict=True))
        if os.path.normpath(source) != resolved:
            raise UnsafePath(source, "source-has-symlink-parent")
        roots.append((resolved, stat.S_ISDIR(info.st_mode)))
    for root, is_directory in roots:
        if not is_directory:
            continue
        active_path = root
        stack.append(os.scandir(root))
        while stack:
            try:
                entry = next(stack[-1])
            except StopIteration:
                stack.pop().close()
                continue
            active_path = entry.path
            info = entry.stat(follow_symlinks=False)
            if stat.S_ISLNK(info.st_mode):
                resolve_covered_link(entry.path)
            elif stat.S_ISDIR(info.st_mode):
                # Keep one iterator per depth, never materialize directory listings.
                stack.append(os.scandir(entry.path))
    result = {"ok": True}
except UnsafePath as error:
    result = {"ok": False, "path": error.path, "reason": error.reason}
except (OSError, ValueError, RuntimeError):
    result = {"ok": False, "path": active_path, "reason": "incomplete-scan"}
finally:
    for iterator in stack:
        iterator.close()
print(json.dumps(result))
'''


def check_archive_symlinks(runner, sources):
    """Reject incomplete cold backups without dereferencing links outside sources."""
    try:
        result = json.loads(runner.run([
            "sudo", "-n", "python3", "-I", "-c", ARCHIVE_SYMLINK_CHECK,
            *[str(source) for source in sources],
        ]))
    except (UpdateError, OSError, ValueError) as error:
        raise UpdateError("无法完整检查备份路径的符号链接，拒绝继续。") from error
    require(isinstance(result, dict) and result.get("ok") is True,
            "备份范围存在未覆盖的符号链接，或无法完整检查路径：" +
            safe_text(result.get("path", "") if isinstance(result, dict) else ""))


def mount_signature(container):
    return sorted((m["Type"], m["Source"], m["Destination"], bool(m["RW"]))
                  for m in container["Mounts"])


def compatible_changes(old, new, comparison):
    require(version_tuple(old)[:2] == version_tuple(new)[:2],
            "此更新跨主要或次要版本，需要先检查数据迁移；自动更新已停止。")
    require(version_tuple(new) > version_tuple(old), "目标不是更新的正式版本。")
    require(comparison.get("status") == "ahead", "无法确认新版包含当前版本历史。")
    files = comparison.get("files", [])
    require(0 < len(files) < 300, "版本差异为空或超过 GitHub 文件列表上限，需要人工检查。")
    names = [f[k] for f in files for k in ("filename", "previous_filename") if k in f]
    critical = [name for name in names if name.startswith(CRITICAL_PATHS)]
    require(not critical, "存在后端源码或部署变更，需先审查数据兼容性：\n" + "\n".join(critical))


class Runner:
    def run(self, args, *, output=None):
        # Finish an in-flight stop/up/tar before recovery. Killing only its CLI
        # can leave a daemon operation or root tar process running underneath us.
        interrupted = []

        def defer(signum, frame):
            if not interrupted:
                print("收到中断请求，等待当前命令结束后恢复服务…", file=sys.stderr, flush=True)
            interrupted.append(signum)

        handlers = {s: signal.signal(s, defer) for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
        try:
            # Keep the controlling terminal/session for sudo's tty credentials,
            # but isolate the child process group from terminal Ctrl-C. A tiny
            # guardian also works on Debian's Python 3.9/3.10, without using
            # preexec_fn in this multithreaded process or invoking a shell. It
            # retains the deployment lock until its child finishes, even if the
            # interactive parent is killed; sudo itself closes extra descriptors.
            wrapper = ("import os,sys,subprocess; os.setpgrp(); "
                       "sys.exit(subprocess.run(sys.argv[1:]).returncode)")
            lock_fd = getattr(self, "lock_fd", None)
            result = subprocess.run([sys.executable, "-c", wrapper, *args],
                                    stdout=output or subprocess.PIPE,
                                    stderr=subprocess.PIPE, check=False,
                                    pass_fds=() if lock_fd is None else (lock_fd,))
        finally:
            for sig, handler in handlers.items():
                signal.signal(sig, handler)
        if interrupted:
            raise KeyboardInterrupt
        # Capture errors rather than leaking Compose environment/secret values.
        require(result.returncode == 0,
                f"命令失败（退出码 {result.returncode}）：" + " ".join(args[:5]))
        return result.stdout.decode("utf-8") if output is None else ""


class Updater:
    def __init__(self, compose_dir, data_dir, backup_dir, state_dir, runner=None):
        self.compose_dir = Path(compose_dir).expanduser().resolve()
        self.data_dir = Path(data_dir).expanduser().resolve()
        self.backup_dir = Path(backup_dir).expanduser().resolve()
        self.state_dir = Path(state_dir).expanduser().resolve()
        self.env_file = self.compose_dir / ".env"
        self.runner = runner or Runner()
        self.state = {"format": 1, "current": None, "previous": None, "pending": None}
        self.compose_args = None
        self.lock = None

    def docker(self, *args):
        return self.runner.run(["sudo", "-n", "docker", "--host=unix:///var/run/docker.sock", *args])

    def inspect(self, kind, ref):
        result = json.loads(self.docker(kind, "inspect", ref))
        require(len(result) == 1, "Docker inspect 返回了不明确的对象。")
        return result[0]

    def compose(self, *args, image=None):
        require(self.compose_args is not None, "尚未确认 Compose 项目。")
        prefix = ["sudo", "-n"]
        if image:
            prefix += ["env", "ZWEIBLOG_IMAGE=" + image]
        return self.runner.run(prefix + ["docker", "--host=unix:///var/run/docker.sock", "compose"] + self.compose_args + list(args))

    def acquire(self):
        require(self.compose_dir.is_dir(), f"部署目录不存在：{self.compose_dir}")
        require(self.data_dir != Path("/") and self.data_dir.is_dir(), "持久化目录不存在或不安全。")
        require(not self.backup_dir.is_relative_to(self.data_dir), "备份目录不能位于数据目录中。")
        # The lock is tied to deployment, even when --state-dir differs.
        lock_path = self.compose_dir / ".zweiblog-updater.lock"
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        self.lock = os.fdopen(fd, "w")
        try:
            fcntl.flock(self.lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise UpdateError("已有更新脚本正在操作此部署。") from None
        self.runner.lock_fd = self.lock.fileno()
        self.state_dir.mkdir(parents=True, mode=0o700, exist_ok=True)
        require(self.state_dir.stat().st_uid == os.getuid(), "更新状态目录不属于当前用户。")
        os.chmod(self.state_dir, 0o700)
        self.backup_dir.mkdir(parents=True, mode=0o700, exist_ok=True)
        path = self.state_dir / "state.json"
        if path.exists():
            try:
                self.state = json.loads(path.read_text())
                require(self.state["format"] == 1 and
                        self.state["compose_dir"] == str(self.compose_dir) and
                        self.state["data_dir"] == str(self.data_dir), "状态记录与部署不匹配。")
                for key in ("current", "previous", "pending"):
                    require(key in self.state, "状态记录不完整。")
                for key in ("current", "previous"):
                    if self.state[key]:
                        require(IMAGE_ID.fullmatch(self.state[key]["id"]), "状态镜像 ID 无效。")
            except (ValueError, KeyError, TypeError):
                raise UpdateError("更新状态文件损坏；为保护回滚镜像，停止操作。") from None

    def save(self):
        self.state.update(compose_dir=str(self.compose_dir), data_dir=str(self.data_dir))
        atomic_write(self.state_dir / "state.json",
                     (json.dumps(self.state, ensure_ascii=False, indent=2) + "\n").encode())

    def containers(self):
        ids = self.docker("ps", "-aq", "--no-trunc").split()
        return [self.inspect("container", cid) for cid in ids]

    def discover(self):
        containers = self.containers()
        apps = [c for c in containers if
                (c["Config"].get("Labels") or {}).get("com.docker.compose.service") == "zweiblog" and
                (c["Config"].get("Labels") or {}).get("com.docker.compose.project.working_dir") == str(self.compose_dir)]
        require(len(apps) == 1, "必须在指定部署目录找到唯一的 ZweiBlog Compose 容器。")
        app = apps[0]
        labels = app["Config"]["Labels"]
        project = labels["com.docker.compose.project"]
        mongos = [c for c in containers if
                  (c["Config"].get("Labels") or {}).get("com.docker.compose.project") == project and
                  (c["Config"].get("Labels") or {}).get("com.docker.compose.service") == "mongo"]
        require(len(mongos) == 1, "必须找到唯一的现有 MongoDB 容器。")
        files = labels.get("com.docker.compose.project.config_files", "").split(",")
        require(files and all(Path(f).is_file() and Path(f).is_absolute() for f in files),
                "无法找到原部署使用的全部 Compose 配置文件。")
        env_label = labels.get("com.docker.compose.project.environment_file", "")
        require(not env_label or env_label == str(self.env_file), "部署使用了额外 env 文件，需要人工核对。")
        require(self.env_file.is_file() and not self.env_file.is_symlink(), ".env 必须是普通文件。")
        require(self.env_file.stat().st_uid == os.getuid(), ".env 必须属于运行脚本的用户。")
        self.compose_args = ["--project-directory", str(self.compose_dir), "--env-file", str(self.env_file), "-p", project]
        for f in files:
            self.compose_args += ["-f", f]
        return app, mongos[0], files

    def config(self, image=None):
        return json.loads(self.compose("config", "--format", "json", image=image))

    def check_config(self, target):
        before = self.config()
        after = self.config(image=target)
        require(after["services"]["zweiblog"]["image"] == target,
                "Compose 没有使用 ZWEIBLOG_IMAGE 变量，拒绝更新。")
        expected = copy.deepcopy(before)
        expected["services"]["zweiblog"]["image"] = target
        require(after == expected, "切换镜像同时改变了其它 Compose 配置，拒绝更新。")
        return before

    def check_running_config(self, app, mongo):
        # Fail closed if files/env were edited since the running containers were
        # created. This also catches port, secret, network and mount changes.
        for service, container in (("zweiblog", app), ("mongo", mongo)):
            expected = container["Config"].get("Labels", {}).get("com.docker.compose.config-hash")
            fields = self.compose("config", "--hash", service,
                                  image=app["Config"]["Image"]).split()
            require(expected and fields == [service, expected],
                    f"{service} 的部署配置与运行容器不一致（或 Compose 版本改变了配置摘要）。请先核对，尚未停机。")

    def wait_healthy(self, cid, timeout=360):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            state = self.inspect("container", cid)["State"]
            require(state.get("Running"), "容器已停止，健康检查失败。")
            status = state.get("Health", {}).get("Status")
            require(status is not None, "容器缺少健康检查，无法自动判断升级结果。")
            if status == "healthy":
                return
            require(status != "unhealthy", "容器报告 unhealthy。")
            time.sleep(3)
        raise UpdateError("等待容器健康检查超时。")

    def validate_mounts(self, app, mongo):
        expected = {
            "/app/static": self.data_dir / "data/static",
            "/var/log": self.data_dir / "log",
            "/home/zweiblog/.config/caddy": self.data_dir / "caddy/config",
            "/home/zweiblog/.local/share/caddy": self.data_dir / "caddy/data",
        }
        for container, paths in ((app, expected), (mongo, {"/data/db": self.data_dir / "data/mongo"})):
            mounts = {m["Destination"]: m for m in container["Mounts"]}
            for target, source in paths.items():
                require(target in mounts and mounts[target]["Type"] == "bind" and
                        Path(mounts[target]["Source"]).resolve() == source,
                        f"数据挂载与预期不符：{target}")
        external = []
        for c in (app, mongo):
            for mount in c["Mounts"]:
                source = Path(mount["Source"]).resolve()
                if source.is_relative_to(self.data_dir):
                    continue
                if c["Id"] == mongo["Id"] and mount["Destination"] == "/data/configdb" and mount["Type"] == "volume":
                    external.append(str(source))
                else:
                    require(not mount["RW"] and mount["Type"] == "bind" and source.is_file(),
                            f"存在未覆盖的外部可写挂载：{mount['Destination']}")
                    external.append(str(source))
        protected_sources = [self.data_dir] + [Path(source) for source in external]
        for c in self.containers():
            if c["Id"] in (app["Id"], mongo["Id"]):
                continue
            for mount in c.get("Mounts", []):
                path = Path(mount["Source"]).resolve()
                require(not (mount["RW"] and any(path.is_relative_to(source) or source.is_relative_to(path)
                                               for source in protected_sources)),
                        "另一个容器也可写入待备份数据或配置；停止自动更新以避免并发写入。")
        return external

    @staticmethod
    def github(path):
        request = urllib.request.Request(API + path, headers={
            "Accept": "application/vnd.github+json", "User-Agent": "ZweiBlog-Compose-Updater",
        })
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = response.read(8 * 1024 * 1024 + 1)
                require(len(data) <= 8 * 1024 * 1024, "GitHub 返回内容过大。")
                return json.loads(data)
        except (OSError, ValueError) as error:
            raise UpdateError("无法查询 GitHub；未开始停机操作。请检查网络或 API 限额。") from error

    def latest(self):
        release = self.github("/releases/latest")
        require(not release.get("draft") and not release.get("prerelease"), "拒绝预发布或草稿版本。")
        version_tuple(release["tag_name"])
        return release

    def pull_release(self, repo, release, old_version):
        version = release["tag_name"]
        if version != old_version:
            compare = self.github("/compare/" + old_version + "..." + version)
            compatible_changes(old_version, version, compare)
        ref = repo + ":" + version
        print(f"正在拉取 {ref}（此时服务继续运行）…", flush=True)
        self.docker("pull", ref)
        image = self.inspect("image", ref)
        require(image_version(image) == version, "镜像内版本与 GitHub 正式版不一致。")
        labels = image["Config"].get("Labels") or {}
        require(labels.get("org.opencontainers.image.source", "").lower().rstrip("/") ==
                "https://github.com/x2m7/zweiblog", "镜像来源标签不匹配。")
        revision = labels.get("org.opencontainers.image.revision")
        commit = self.github("/commits/" + version).get("sha")
        require(revision and revision == commit, "镜像提交与发布标签不一致。")
        refs = [s for s in image.get("RepoDigests", []) if s.startswith(repo + "@sha256:")]
        require(len(refs) == 1 and IMAGE_ID.fullmatch(refs[0].split("@", 1)[1]), "无法固定镜像摘要。")
        require(self.inspect("image", refs[0])["Id"] == image["Id"], "镜像摘要与已拉取镜像不一致。")
        return {"id": image["Id"], "ref": refs[0], "version": version}

    def archive(self, path, sources):
        partial = Path(str(path) + ".partial")
        with partial.open("xb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            self.runner.run(["sudo", "-n", "tar", "--numeric-owner", "--acls", "--xattrs",
                             "-czf", "-", "-C", "/", "--"] + [str(Path(p)).lstrip("/") for p in sources], output=stream)
            stream.flush()
            os.fsync(stream.fileno())
        # tar reads every member and verifies the gzip stream; no extraction.
        with open(os.devnull, "wb") as sink:
            self.runner.run(["tar", "-tzf", str(partial)], output=sink)
        os.replace(partial, path)
        return digest_file(path)

    def assert_config_unchanged(self, pending):
        for path, sha in pending["config_hashes"].items():
            require(digest_file(path) == sha, "部署配置在操作期间被修改，已停止：" + path)

    def verify(self, target, pending):
        app, mongo, _ = self.discover()
        require(mongo["Id"] == pending["mongo_id"] and mongo["Image"] == pending["mongo_image"],
                "MongoDB 容器发生变化，拒绝确认更新。")
        require(app["Image"] == target["id"], "应用实际镜像与目标不一致。")
        require([list(m) for m in mount_signature(app)] == pending["app_mounts"] and
                [list(m) for m in mount_signature(mongo)] == pending["mongo_mounts"],
                "数据挂载发生变化，拒绝确认更新。")
        require(image_version(app) == target["version"], "运行容器的版本不符合预期。")
        self.wait_healthy(mongo["Id"])
        self.wait_healthy(app["Id"])

    def remove_incomplete_replacement(self, pending, original_app):
        # Compose creates a temporary replacement before removing the old
        # container. A failed create/recreate can leave both behind. Only a
        # never-started, exactly identified replacement can be discarded safely.
        others = [c for c in self.containers() if c["Id"] != original_app["Id"] and
                  (c["Config"].get("Labels") or {}).get("com.docker.compose.service") == "zweiblog" and
                  (c["Config"].get("Labels") or {}).get("com.docker.compose.project.working_dir") == str(self.compose_dir)]
        if not others:
            return
        identity = pending.get("app_identity")
        require(identity and len(others) == 1 and original_app.get("Name") == identity["name"],
                "发现无法确认身份的额外应用容器，保留容器并停止自动恢复。")
        candidate = others[0]
        labels = candidate["Config"].get("Labels") or {}
        expected_labels = dict(identity["labels"])
        expected_labels["com.docker.compose.replace"] = identity["replacement_label"]
        expected_name = "/" + original_app["Id"][:12] + "_" + identity["name"].lstrip("/")
        state = candidate["State"]
        require(candidate.get("Name") == expected_name and
                candidate["Image"] == pending["target"]["id"] and
                candidate["Config"]["Image"] == pending["target"]["ref"] and
                all(labels.get(key) == value for key, value in expected_labels.items()) and
                [list(m) for m in mount_signature(candidate)] == pending["app_mounts"] and
                state.get("Status") == "created" and not state.get("Running") and
                state.get("StartedAt") == "0001-01-01T00:00:00Z",
                "额外应用容器不是本事务从未启动的临时替换容器，保留容器并停止自动恢复。")
        # Container IDs cannot be retargeted. No force and no volume deletion:
        # Docker refuses removal if another operator starts it after the check.
        self.docker("container", "rm", candidate["Id"])

    def restore(self):
        pending = self.state["pending"]
        require(pending, "没有待恢复事务。")
        print("恢复更新前的镜像与配置；数据库内容不会被旧备份覆盖…", flush=True)
        require(pending["compose_dir"] == str(self.compose_dir), "恢复目录不匹配。")
        self.compose_args = pending["compose_args"]
        old = pending["old"]
        require(self.inspect("image", old["ref"])["Id"] == old["id"], "回滚镜像缺失或被改写。")
        mongo = self.inspect("container", pending["mongo_id"])
        require(mongo["Image"] == pending["mongo_image"] and
                [list(m) for m in mount_signature(mongo)] == pending["mongo_mounts"], "原 MongoDB 容器发生变化，停止自动恢复。")
        self.docker("start", pending["mongo_id"])
        self.wait_healthy(pending["mongo_id"])
        original_app = next((c for c in self.containers() if c["Id"] == pending["app_id"]), None)
        if original_app:
            require(original_app["Image"] == old["id"], "原应用容器镜像发生变化。")
            self.remove_incomplete_replacement(pending, original_app)
            # Restore availability even if someone edited a config during backup.
            self.docker("start", original_app["Id"])
            self.wait_healthy(original_app["Id"])
        backup_env = Path(pending["backup"]) / ".env.before"
        original = backup_env.read_bytes()
        require(hashlib.sha256(original).hexdigest() == pending["env_sha"], "原配置备份校验失败。")
        current = self.env_file.read_bytes()
        expected_new = replace_image_env(original, pending["target"]["ref"])
        restored_env = replace_image_env(original, old["ref"])
        require(current in (original, expected_new, restored_env),
                ".env 被外部修改；已尽可能启动原容器，请人工核对配置后再次恢复。")
        self.assert_config_unchanged(pending)
        require(self.config(image=pending["baseline"]["services"]["zweiblog"]["image"]) == pending["baseline"],
                "引用的 Compose 配置发生了变化，已尽可能启动原容器，请核对配置。")
        # Pin first so recovery remains idempotent even after another interruption.
        atomic_write(self.env_file, restored_env, pending["env_mode"])
        if not original_app:
            self.compose("up", "-d", "--no-deps", "--no-build", "--pull", "never", "zweiblog", image=old["ref"])
        self.verify(old, pending)
        prior = pending["prior_state"]
        previous = prior["previous"] if prior["current"] and prior["current"]["id"] == old["id"] else None
        self.state.update(current=old, previous=previous, pending=None)
        try:
            self.save()
        except BaseException:
            self.state["pending"] = pending
            raise
        print("已恢复原应用，健康检查通过。")

    def transaction(self, target):
        require(not self.state["pending"], "有未完成事务，必须先恢复。")
        app, mongo, files = self.discover()
        if app["Image"] == target["id"]:
            print("当前已运行此镜像；不变更上一版记录。")
            return False
        self.wait_healthy(app["Id"])
        self.wait_healthy(mongo["Id"])
        self.check_running_config(app, mongo)
        external = self.validate_mounts(app, mongo)
        original = self.env_file.read_bytes()
        updated = replace_image_env(original, target["ref"])
        baseline = self.check_config(target["ref"])
        # Catch stale .env before downtime; never deploy an unrelated service config.
        require(self.inspect("image", baseline["services"]["zweiblog"]["image"])["Id"] == app["Image"],
                ".env 镜像与实际运行镜像不同，请先核对部署状态。")
        require(self.inspect("image", target["ref"])["Id"] == target["id"], "目标镜像引用发生变化。")
        old_image = self.inspect("image", app["Image"])
        new_image = self.inspect("image", target["id"])
        require(new_image.get("Architecture") == old_image.get("Architecture") and
                new_image.get("Os") == old_image.get("Os") == "linux", "目标镜像架构或系统不匹配。")
        stamp = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
        backup = self.backup_dir / ("before-" + target["version"] + "-" + stamp)
        # du is an estimate; tar errors are still fatal and trigger service restart.
        sources = list(dict.fromkeys([str(self.data_dir)] + external + files + [str(self.env_file)]))
        check_archive_symlinks(self.runner, sources)
        sizes = self.runner.run(["sudo", "-n", "du", "-sb", "--"] + sources)
        estimate = sum(int(line.split()[0]) for line in sizes.splitlines())
        require(shutil.disk_usage(self.backup_dir).free > estimate + 1024 ** 3,
                "备份磁盘空间不足（需要数据估算大小加 1 GiB 余量）。")
        backup.mkdir(mode=0o700)
        atomic_write(backup / ".env.before", original)
        rollback_ref = "zweiblog-local-rollback:updater-" + stamp
        self.docker("image", "tag", app["Image"], rollback_ref)
        old = {"id": app["Image"], "ref": rollback_ref, "version": image_version(app)}
        app_labels = app["Config"]["Labels"]
        identity_labels = {key: app_labels[key] for key in (
            "com.docker.compose.project", "com.docker.compose.service",
            "com.docker.compose.project.working_dir", "com.docker.compose.project.config_files",
            "com.docker.compose.container-number") if key in app_labels}
        number = app_labels.get("com.docker.compose.container-number")
        replacement_label = baseline["services"]["zweiblog"].get("container_name") or (
            "zweiblog-" + number if number else None)
        complete_identity = app.get("Name") and replacement_label and len(identity_labels) == 5
        pending = {
            "old": old, "target": target, "backup": str(backup), "phase": "prepared",
            "compose_dir": str(self.compose_dir), "compose_args": self.compose_args,
            "mongo_id": mongo["Id"], "mongo_image": mongo["Image"], "app_id": app["Id"],
            "app_identity": {"name": app.get("Name"), "labels": identity_labels,
                             "replacement_label": replacement_label} if complete_identity else None,
            "app_mounts": [list(m) for m in mount_signature(app)],
            "mongo_mounts": [list(m) for m in mount_signature(mongo)],
            "config_hashes": {f: digest_file(f) for f in files},
            "env_sha": hashlib.sha256(original).hexdigest(),
            "env_mode": self.env_file.stat().st_mode & 0o777,
            "baseline": baseline,
            "prior_state": {"current": copy.deepcopy(self.state["current"]),
                            "previous": copy.deepcopy(self.state["previous"])},
        }
        self.state["pending"] = pending
        atomic_write(backup / "recovery.json", (json.dumps(pending, ensure_ascii=False, indent=2) + "\n").encode())
        self.save()  # Durable journal BEFORE stopping any service.
        try:
            print("暂停博客和 MongoDB，开始完整备份（期间网站暂时不可用）…", flush=True)
            self.docker("stop", "--time", "120", app["Id"])
            require(not self.inspect("container", app["Id"])["State"]["Running"], "应用未停止。")
            self.docker("stop", "--time", "120", mongo["Id"])
            mongo_state = self.inspect("container", mongo["Id"])["State"]
            require(not mongo_state["Running"] and mongo_state["ExitCode"] == 0 and not mongo_state.get("OOMKilled"),
                    "MongoDB 未正常退出，拒绝备份或继续更新。")
            check_archive_symlinks(self.runner, sources)
            sha = self.archive(backup / "data-and-config.tar.gz", sources)
            for container in (app, mongo):
                state = self.inspect("container", container["Id"])["State"]
                require(not state["Running"] and state.get("StartedAt") == container["State"].get("StartedAt"),
                        "备份期间容器被重新启动，拒绝使用此备份。")
            atomic_write(backup / "BACKUP_OK", (sha + "  data-and-config.tar.gz\n").encode())
            pending["phase"] = "backup_verified"
            self.save()
            self.docker("start", mongo["Id"])
            self.wait_healthy(mongo["Id"])
            self.assert_config_unchanged(pending)
            require(self.env_file.read_bytes() == original, ".env 在备份期间被修改，拒绝覆盖。")
            require(self.config() == baseline, "Compose 配置在备份期间发生变化。")
            pending["phase"] = "switching"
            self.save()
            atomic_write(self.env_file, updated, pending["env_mode"])
            self.compose("up", "-d", "--no-deps", "--no-build", "--pull", "never", "zweiblog")
            self.verify(target, pending)
            self.state.update(current=target, previous=old, pending=None)
            self.save()  # Commit retention and clear the journal in ONE atomic write.
        except BaseException:
            # A failed commit can have changed in-memory state; journal stays authoritative.
            self.state["pending"] = pending
            try:
                self.restore()
            except BaseException as recovery_error:
                print("自动恢复未完成：" + safe_text(recovery_error), file=sys.stderr)
                print(f"保留恢复记录与备份：{backup}。再次运行脚本选择恢复。", file=sys.stderr)
            raise
        print(f"更新成功：{target['version']}；上一版：{old['version']}\n完整备份：{backup}")
        return True

    def cleanup(self):
        require(not self.state["pending"], "存在未完成事务，禁止清理。")
        app, _, _ = self.discover()
        current, previous = self.state["current"], self.state["previous"]
        require(current and previous, "尚无本脚本确认的上一版记录；先完成一次更新，不猜测或删除已有回滚镜像。")
        require(app["Image"] == current["id"], "运行镜像与更新记录不一致，禁止清理。")
        require(self.inspect("image", previous["ref"])["Id"] == previous["id"], "上一版镜像缺失，禁止清理。")
        protected = {current["id"], previous["id"]}
        ids = set(self.docker("image", "ls", "-aq", "--no-trunc").split())
        removed = 0
        for iid in sorted(ids - protected):
            obj = self.inspect("image", iid)
            refs = (obj.get("RepoTags") or []) + (obj.get("RepoDigests") or [])
            if not refs or any(repository(ref) not in ALLOWED_REPOS for ref in refs):
                continue
            # Includes stopped containers. Re-read before each image deletion.
            if iid in {c["Image"] for c in self.containers()}:
                print("保留其它容器仍引用的镜像：" + iid[:19])
                continue
            print("清理旧 ZweiBlog 镜像：" + ", ".join(refs))
            for ref in refs:
                # Removal of the final tag may also remove the digest/image.
                remaining = set(self.docker("image", "ls", "-aq", "--no-trunc").split())
                if iid not in remaining:
                    break
                live = self.inspect("image", iid)
                live_refs = (live.get("RepoTags") or []) + (live.get("RepoDigests") or [])
                require(all(repository(r) in ALLOWED_REPOS for r in live_refs), "清理期间镜像新增了其它仓库引用，已停止。")
                if ref not in live_refs:
                    continue
                require(self.inspect("image", ref)["Id"] == iid, "清理期间镜像标签发生变化，已停止。")
                require(iid not in {c["Image"] for c in self.containers()}, "清理期间镜像被容器引用，已停止。")
                self.docker("image", "rm", ref)  # Deliberately never --force or prune.
            removed += 1
        print(f"清理完成，处理了 {removed} 个旧镜像。保留当前版 {current['version']} 和上一版 {previous['version']}。")

    def status(self):
        app, mongo, _ = self.discover()
        print(f"部署目录：{self.compose_dir}\n当前应用：{image_version(app)}\n镜像：{app['Config']['Image']}")
        print(f"MongoDB：{mongo['Config']['Image']}（{mongo['State'].get('Health', {}).get('Status', '无健康检查')}）")
        previous = self.state["previous"]
        print("脚本记录的上一版：" + (previous["version"] if previous else "尚未记录"))
        print(f"备份目录：{self.backup_dir}\n状态目录：{self.state_dir}")


def confirm(prompt):
    return input(prompt + " 输入 y 确认，其它键取消：").strip().lower() == "y"


def main():
    parser = argparse.ArgumentParser(description="ZweiBlog Compose 交互式更新：完整备份、当前/上一镜像保留、故障恢复。")
    parser.add_argument("--compose-dir", default=str(Path.home() / "zweiblog/docker-compose"))
    parser.add_argument("--data-dir", default="/var/zweiblog")
    parser.add_argument("--backup-dir", default=str(Path.home() / "zweiblog-backups"))
    parser.add_argument("--state-dir", help="默认 ~/.local/state/zweiblog-updater/<部署目录标识>")
    args = parser.parse_args()
    require(sys.version_info >= (3, 9), "需要 Python 3.9 或更高版本，请先更新 Python。")
    require(os.geteuid() != 0, "请以部署用户执行 python3 zweiblog-update.py，不要在前面加 sudo。")
    for executable in ("sudo", "docker", "tar", "du"):
        require(shutil.which(executable), "缺少命令：" + executable)
    key = hashlib.sha256(str(Path(args.compose_dir).expanduser().resolve()).encode()).hexdigest()[:16]
    state_dir = args.state_dir or Path.home() / ".local/state/zweiblog-updater" / key
    updater = Updater(args.compose_dir, args.data_dir, args.backup_dir, state_dir)
    updater.acquire()
    require(subprocess.call(["sudo", "-v"]) == 0, "未获得 Docker/备份所需的 sudo 权限。")
    keepalive_stop = threading.Event()

    def keepalive():
        while not keepalive_stop.wait(40):
            subprocess.run(["sudo", "-n", "-v"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    threading.Thread(target=keepalive, daemon=True).start()
    def on_signal(signum, frame):
        raise KeyboardInterrupt

    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, on_signal)
    try:
        updater.docker("info", "--format", "{{.ServerVersion}}")
        if updater.state["pending"]:
            require(confirm("检测到上次更新中断，先恢复更新前镜像？"), "未恢复事务，已停止其它操作。")
            updater.restore()
        while True:
            updater.status()
            print("\n1. 从腾讯云更新最新正式版\n2. 从 GHCR 更新最新正式版\n3. 回滚到上一镜像\n4. 清理更早的 ZweiBlog 镜像\n0. 退出")
            choice = input("请选择：").strip()
            if choice == "0":
                return
            try:
                if choice in REPOS:
                    release = updater.latest()
                    app, _, _ = updater.discover()
                    old_version = image_version(app)
                    print("最新正式版：" + release["tag_name"])
                    print("发布说明：https://github.com/X2M7/zweiblog/releases/tag/" + release["tag_name"])
                    print(safe_text(release.get("body", ""))[:6000])
                    if not confirm("更新会短暂停机备份，通过检查后删除更早的博客镜像；继续？"):
                        continue
                    target = updater.pull_release(REPOS[choice], release, old_version)
                    changed = updater.transaction(target)
                    if changed:
                        try:
                            updater.cleanup()
                        except (UpdateError, OSError, ValueError) as error:
                            print("更新已成功，但清理未完成，可稍后选 4 重试：" + safe_text(error))
                elif choice == "3":
                    previous = updater.state["previous"]
                    require(previous and updater.state["current"], "尚无可用的上一版记录。")
                    app, _, _ = updater.discover()
                    require(app["Image"] == updater.state["current"]["id"], "运行版本与状态记录不一致，拒绝回滚。")
                    if confirm("回滚到 " + previous["version"] + "？将先备份现有数据，数据库内容不会回退"):
                        if updater.transaction(previous):
                            try:
                                updater.cleanup()
                            except (UpdateError, OSError, ValueError) as error:
                                print("回滚已成功，清理未完成：" + safe_text(error))
                elif choice == "4":
                    if confirm("只清理更早的 ZweiBlog 镜像，保留当前版与上一版？"):
                        updater.cleanup()
                else:
                    print("请输入菜单中的数字。")
            except (UpdateError, OSError, ValueError, KeyError) as error:
                print("操作停止：" + safe_text(error), file=sys.stderr)
                if updater.state["pending"]:
                    return
    finally:
        keepalive_stop.set()


if __name__ == "__main__":
    try:
        main()
    except (UpdateError, OSError, ValueError, EOFError) as error:
        print("停止：" + safe_text(error), file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n已中断；如有未完成事务，下次运行会要求先恢复。", file=sys.stderr)
        sys.exit(130)
