import {
  activeISR,
  getISRConfig,
  getLoginConfig,
  updateISRConfig,
  updateLoginConfig,
} from '@/services/zwei-blog/api';
import { ProForm, ProFormDigit, ProFormSelect } from '@ant-design/pro-components';
import { Alert, Button, Card, message, Modal } from 'antd';
import { useState } from 'react';

const defaultLoginConfig = {
  enableMaxLoginRetry: true,
  maxRetryTimes: 5,
  durationSeconds: 15 * 60,
  expiresIn: 7 * 24 * 60 * 60,
};

export default function (props) {
  const [isrLoading, setIsrLoading] = useState(false);
  return (
    <>
      <Card title="登录安全策略">
        <Alert
          type="info"
          message="默认同一来源 IP 与用户名在 15 分钟内最多登录失败 5 次；登录成功后会清除失败记录。"
          style={{ marginBottom: 8 }}
        />
        <ProForm
          grid={true}
          layout={'horizontal'}
          request={async (params) => {
            try {
              const { data } = await getLoginConfig();
              return { ...defaultLoginConfig, ...(data || {}) };
            } catch (err) {
              console.log(err);
              return defaultLoginConfig;
            }
          }}
          syncToInitialValues={true}
          onFinish={async (data) => {
            if (location.hostname == 'blog-demo.mereith.com') {
              Modal.info({ title: '演示站禁止修改登录安全策略！' });
              return;
            }
            await updateLoginConfig(data);
            message.success('更新成功！');
          }}
        >
          <ProFormSelect
            name={'enableMaxLoginRetry'}
            label="开启最大登录失败次数限制"
            fieldProps={{
              options: [
                {
                  label: '开启',
                  value: true,
                },
                {
                  label: '关闭',
                  value: false,
                },
              ],
            }}
            placeholder="开启"
            tooltip={'默认开启，按来源 IP 与规范化用户名共同计数'}
          ></ProFormSelect>
          <ProFormDigit
            name={'maxRetryTimes'}
            label="最大登录失败次数"
            min={1}
            max={100}
            placeholder={'默认为 5 次'}
            tooltip="达到该次数后，在限制窗口结束前拒绝新的登录尝试。"
          />
          <ProFormDigit
            name={'durationSeconds'}
            label="登录失败限制窗口(秒)"
            min={1}
            max={86400}
            placeholder={'默认为 900 秒（15 分钟）'}
            tooltip="失败计数的有效时间，默认为 900 秒。"
          />
          <ProFormDigit
            name={'expiresIn'}
            label="登录凭证(Token)有效期(秒)"
            min={60}
            placeholder={'默认为 7 天'}
            tooltip="默认为 7 天"
          />
        </ProForm>
      </Card>

      <Card title="静态页面更新策略" style={{ marginTop: 8 }}>
        <Alert
          type="info"
          message={
            <a
              rel="noreferrer"
              target="_blank"
              href="https://vanblog.mereith.com/feature/advance/isr.html"
            >
              帮助文档
            </a>
          }
          style={{ marginBottom: 8 }}
        />
        <ProForm
          grid={true}
          layout={'horizontal'}
          request={async (params) => {
            try {
              const { data } = await getISRConfig();
              console.log(data);
              return data;
            } catch (err) {
              console.log(err);
              return {};
            }
          }}
          syncToInitialValues={true}
          onFinish={async (data) => {
            if (location.hostname == 'blog-demo.mereith.com') {
              Modal.info({ title: '演示站禁止修改静态页面更新策略！' });
              return;
            }
            await updateISRConfig(data);
            message.success('更新成功！');
          }}
        >
          <ProFormSelect
            name={'mode'}
            label="静态页面更新策略"
            fieldProps={{
              options: [
                {
                  label: '延时自动',
                  value: 'delay',
                },
                {
                  label: '按需自动',
                  value: 'onDemand',
                },
              ],
            }}
            tooltip={'默认为延时自动，使用按需自动可提高实时性，但需要更多性能（4核心以上推荐）'}
          ></ProFormSelect>
          <ProFormDigit
            name={'delay'}
            label="延时自动更新时间(秒)"
            tooltip="默认为 10 秒。表示每 10 秒，博客前台服务会尝试根据最新的后端数据来更新静态页面。"
          />
        </ProForm>
      </Card>
      <Card title="手动触发静态页面更新" style={{ marginTop: 8 }}>
        <Alert
          type="info"
          message="通常来说你不需要这样做，但某些情况下你也可以手动触发增量渲染。这会让后端尝试重新验证/渲染已知所有路由（触发完成后需要一些时间生效）。"
          style={{ marginBottom: 8 }}
        />
        <Button
          type="primary"
          onClick={async () => {
            setIsrLoading(true);
            try {
              await activeISR();
              message.success('ISR 手动触发成功！');
            } catch (err) {
              message.error('ISR 触发失败！');
            }
            setIsrLoading(false);
          }}
          loading={isrLoading}
        >
          手动触发
        </Button>
      </Card>
    </>
  );
}
