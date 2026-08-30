import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { config } from 'src/config/index';
import { AdminGuard } from 'src/provider/auth/auth.guard';
import { ISRProvider } from 'src/provider/isr/isr.provider';
import { SettingProvider } from 'src/provider/setting/setting.provider';
import { ApiToken } from 'src/provider/swagger/token';
import { CommentSetting, LayoutSetting, LoginSetting, StaticSetting } from 'src/types/setting.dto';

@ApiTags('setting')
@UseGuards(...AdminGuard)
@ApiToken
@Controller('/api/admin/setting')
export class SettingController {
  constructor(
    private readonly settingProvider: SettingProvider,
    private readonly isrProvider: ISRProvider,
  ) {}

  private isDemo() {
    return config.demo === true || config.demo === 'true';
  }

  @Get('static')
  async getStaticSetting() {
    return { statusCode: 200, data: await this.settingProvider.getStaticSetting() };
  }

  @Put('static')
  async updateStaticSetting(@Body() body: Partial<StaticSetting>) {
    if (this.isDemo()) return { statusCode: 401, message: '演示站禁止修改静态资源设置' };
    return { statusCode: 200, data: await this.settingProvider.updateStaticSetting(body) };
  }

  @Get('layout')
  async getLayoutSetting() {
    return { statusCode: 200, data: await this.settingProvider.getLayoutSetting() };
  }

  @Put('layout')
  async updateLayoutSetting(@Body() body: LayoutSetting) {
    if (this.isDemo()) return { statusCode: 401, message: '演示站禁止修改布局设置' };
    const data = await this.settingProvider.updateLayoutSetting(body);
    this.isrProvider.activeAll('更新 layout 设置');
    return { statusCode: 200, data };
  }

  @Get('login')
  async getLoginSetting() {
    return { statusCode: 200, data: await this.settingProvider.getLoginSetting() };
  }

  @Put('login')
  async updateLoginSetting(@Body() body: LoginSetting) {
    if (this.isDemo()) return { statusCode: 401, message: '演示站禁止修改登录安全设置' };
    return { statusCode: 200, data: await this.settingProvider.updateLoginSetting(body) };
  }

  @Get('comment')
  async getCommentSetting() {
    return { statusCode: 200, data: await this.settingProvider.getCommentSetting() };
  }

  @Put('comment')
  async updateCommentSetting(@Body() body: Partial<CommentSetting>) {
    if (this.isDemo()) return { statusCode: 401, message: '演示站禁止修改评论设置' };
    return { statusCode: 200, data: await this.settingProvider.updateCommentSetting(body) };
  }
}
