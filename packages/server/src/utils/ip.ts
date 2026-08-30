import * as os from 'os';

// import publicIp from 'public-ip';

export const getLocalIps = () => {
  const res = [];
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4') {
        res.push(alias.address);
      }
    }
  }
  return res;
};
export const getPublicIp = async () => {
  // 不把服务器网络信息发送给第三方；默认只使用本地网卡地址。
  return null;
};
export const getDefaultSubjects = async () => {
  const localIps = await getLocalIps();
  const publicIP = await getPublicIp();
  const result = localIps;
  if (!localIps.includes(publicIP) && Boolean(publicIP)) {
    result.push(publicIP);
  }
  if (!result.includes('127.0.0.1')) {
    result.push('127.0.0.1');
  }
  result.push('localhost');
  return result;
};
export const isIpv4 = (ip: string) => {
  const v4 =
    '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3}';
  const reg = new RegExp(`^${v4}$`);
  return reg.test(ip);
};
