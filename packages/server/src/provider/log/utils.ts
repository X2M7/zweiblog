export async function getNetIp(req: any) {
  // 不直接读取客户端可伪造的转发头，也不把登录来源发送给第三方服务。
  const ip = String(req?.ip || req?.socket?.remoteAddress || '')
    .trim()
    .replace(/^::ffff:/, '');
  return { address: '未查询', ip };
}

export function getPlatform(userAgent: string): 'mobile' | 'desktop' {
  const ua = String(userAgent || '').toLowerCase();
  const testUa = (regexp: RegExp) => regexp.test(ua);

  // 系统
  let system = 'unknow';
  if (testUa(/windows|win32|win64|wow32|wow64/g)) {
    system = 'windows';
  } else if (testUa(/macintosh|macintel/g)) {
    system = 'macos';
  } else if (testUa(/x11/g)) {
    system = 'linux';
  } else if (testUa(/android|adr/g)) {
    system = 'android';
  } else if (testUa(/ios|iphone|ipad|ipod|iwatch/g)) {
    system = 'ios';
  }

  let platform = 'desktop';
  if (system === 'windows' || system === 'macos' || system === 'linux') {
    platform = 'desktop';
  } else if (system === 'android' || system === 'ios' || testUa(/mobile/g)) {
    platform = 'mobile';
  }

  return platform as 'mobile' | 'desktop';
}
