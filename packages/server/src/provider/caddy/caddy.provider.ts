import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as fs from 'fs';
import path from 'path';
import { config } from 'src/config';
import { SettingProvider } from '../setting/setting.provider';
@Injectable()
export class CaddyProvider {
  subjects: string[] = [];
  logger = new Logger(CaddyProvider.name);
  private readonly logDirectory = config.log;
  private readonly logPath = path.join(config.log, 'caddy.log');
  private readonly accessLogPath = path.join(config.log, 'zweiblog-access.log');
  constructor(private readonly settingProvider: SettingProvider) {
    void this.init().catch((error) => {
      this.logger.error('初始化 Caddy 配置失败', error?.stack || error);
    });
  }
  async init() {
    // this.subjects = await getDefaultSubjects();
    // this.logger.log(`默认 subjects:`, this.subjects);
    // await this.updateSubjects(this.subjects);
    const configInDB = await this.settingProvider.getHttpsSetting();
    if (!this.isInternalHttpsEnabled()) {
      if (configInDB?.redirect) {
        await this.settingProvider.updateHttpsSetting({ redirect: false });
      }
      this.logger.log('当前为外部反向代理模式，内置 HTTPS 与自动重定向已禁用');
      return;
    }
    let txt = '初始化 caddy 配置完成！';
    if (configInDB?.redirect) {
      await this.setRedirect(true);
      txt = txt + 'https 自动重定向已开启';
    } else {
      await this.setRedirect(false);
      txt = 'https 自动重定向已关闭';
    }

    this.logger.log(txt);
  }
  clearLog() {
    for (const currentLog of [this.logPath, this.accessLogPath]) {
      try {
        const stat = fs.lstatSync(currentLog);
        if (stat.isFile()) fs.truncateSync(currentLog, 0);
        else this.logger.warn('拒绝清理非普通日志文件：' + currentLog);
      } catch (error) {
        if (error?.code !== 'ENOENT') this.logger.warn('清理日志失败：' + currentLog);
      }
    }

    try {
      for (const entry of fs.readdirSync(this.logDirectory, { withFileTypes: true })) {
        if (entry.isFile() && /^(?:caddy|zweiblog-access)-.+\.log(?:\.gz)?$/.test(entry.name)) {
          fs.unlinkSync(path.join(this.logDirectory, entry.name));
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') this.logger.warn('清理轮转 Caddy 日志失败');
    }
  }
  async addSubject(domain: string) {
    if (!this.isInternalHttpsEnabled()) return;
    if (!this.subjects.includes(domain)) {
      this.subjects.push(domain);
      await this.updateSubjects(this.subjects);
    }
  }

  async setRedirect(redirect: boolean) {
    if (!this.isInternalHttpsEnabled()) {
      if (redirect) {
        this.logger.warn('外部反向代理模式禁止开启内置 HTTPS 自动重定向');
        return false;
      }
      return '外部反向代理模式下内置 HTTPS 已保持关闭';
    }
    if (!redirect) {
      try {
        await axios.delete('http://127.0.0.1:2019/config/apps/http/servers/srv1/listener_wrappers');
        this.logger.log('https 自动重定向已关闭');
        return '关闭成功！';
      } catch (err) {
        // console.log(err);
        this.logger.error('关闭 https 自动重定向失败');
        return false;
      }
    } else {
      try {
        await axios.post('http://127.0.0.1:2019/config/apps/http/servers/srv1/listener_wrappers', [
          {
            wrapper: 'http_redirect',
          },
        ]);
        this.logger.log('https 自动重定向已开启');
        return '开启成功！';
      } catch (err) {
        // console.log(err);
        this.logger.error('开启 https 自动重定向失败');
        return false;
      }
    }
  }

  async getSubjects() {
    if (!this.isInternalHttpsEnabled()) return [];
    try {
      const res = await axios.get(
        'http://127.0.0.1:2019/config/apps/tls/automation/policies/subjects',
      );
      return res?.data;
    } catch (err) {
      // console.log(err);
      this.logger.error('更新 subjects 失败，通过 IP 进行 https 访问可能受限');
    }
  }
  async getAutomaticDomains() {
    if (!this.isInternalHttpsEnabled()) return [];
    try {
      const res = await axios.get('http://127.0.0.1:2019/config/apps/tls/certificates/automate');
      return res?.data;
    } catch (err) {
      console.log(err);
    }
  }

  async updateSubjects(domains: string[]) {
    if (!this.isInternalHttpsEnabled()) return false;
    try {
      const res = await axios.patch(
        'http://127.0.0.1:2019/config/apps/tls/automation/policies/0/subjects',
        domains,
      );
      if (res.status == 200) {
        return true;
      }
    } catch (err) {
      console.log(err?.data?.error || err);
    }
    return false;
  }
  async applyHttpsChange(domains: string[]) {
    if (!this.isInternalHttpsEnabled()) return false;
    return await this.updateHttpsDomains([...domains, ...this.subjects]);
  }

  async updateHttpsDomains(domains: string[]) {
    if (!this.isInternalHttpsEnabled()) return false;
    try {
      const res = await axios.patch(
        'http://127.0.0.1:2019/config/apps/tls/certificates/automate',
        domains,
      );
      if (res.status == 200) {
        return true;
      }
    } catch (err) {
      console.log(err);
    }
    return false;
  }
  async getConfig() {
    try {
      const res = await axios.get('http://127.0.0.1:2019/config');
      return res?.data;
    } catch (err) {
      console.log(err);
    }
  }
  async getLog() {
    try {
      const data = fs.readFileSync(this.logPath, { encoding: 'utf-8' });
      return data.toString();
    } catch (err) {
      return '';
    }
  }

  isInternalHttpsEnabled() {
    return config.caddy.httpsMode === 'on-demand';
  }
}
