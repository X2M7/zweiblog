import ProCard from '@ant-design/pro-card';
import { PageContainer } from '@ant-design/pro-layout';
import { Image, Space, Spin, Tag } from 'antd';
import { useMemo } from 'react';
import { useModel } from 'umi';
export default function (props) {
  const { initialState } = useModel('@@initialState');
  const version = useMemo(() => {
    let v = initialState?.version || '获取中';
    return v;
  }, [initialState, history]);

  return (
    <PageContainer title={null} extra={null} header={{ title: null, extra: null, ghost: true }}>
      <Spin spinning={version == '获取中'}>
        <ProCard>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexDirection: 'column',
              userSelect: 'none',
            }}
          >
            <Image width={200} src="/logo.svg" alt="logo" preview={false} />
            <div
              style={{
                fontSize: 26,
                fontWeight: 500,
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <div>ZweiBlog</div>
              <div style={{ marginBottom: 4, marginLeft: 4 }}>
                <Tag color="cyan">{version}</Tag>
              </div>
            </div>
            <p align="center">面向自托管场景的双语个人博客与本地评论系统</p>

            <Space>
              <a target={'_blank'} rel="noreferrer" href="https://github.com/X2M7/zweiblog">
                Github
              </a>
              <a target={'_blank'} rel="noreferrer" href="https://github.com/X2M7/zweiblog#readme">
                项目文档
              </a>
              <a
                target={'_blank'}
                rel="noreferrer"
                href="https://github.com/X2M7/zweiblog/releases"
              >
                更新日志
              </a>
              <a target={'_blank'} rel="noreferrer" href="/swagger">
                API文档
              </a>
            </Space>
            <Space style={{ marginTop: 8 }}>
              <a
                target={'_blank'}
                rel="noreferrer"
                href="https://github.com/X2M7/zweiblog/issues/new/choose"
              >
                提交BUG
              </a>
              <a
                target={'_blank'}
                rel="noreferrer"
                href="https://github.com/X2M7/zweiblog/issues/new/choose"
              >
                提交案例
              </a>
              <a
                target={'_blank'}
                rel="noreferrer"
                href="https://github.com/Mereithhh/vanblog"
              >
                上游 VanBlog
              </a>
              <a target={'_blank'} rel="noreferrer" href="https://github.com/X2M7/zweiblog/blob/main/LICENSE">
                GPL-3.0 许可证
              </a>
            </Space>
          </div>
        </ProCard>
      </Spin>
    </PageContainer>
  );
}
