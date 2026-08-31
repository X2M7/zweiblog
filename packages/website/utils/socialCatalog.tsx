import type { IconType } from "react-icons";
import {
  FaBookOpen,
  FaBuilding,
  FaCode,
  FaCodeBranch,
  FaCodepen,
  FaCommentSms,
  FaComments,
  FaEnvelope,
  FaGlobe,
  FaHashtag,
  FaLink,
  FaLinkedin,
  FaLocationDot,
  FaMicrosoft,
  FaPhone,
  FaSkype,
  FaSlack,
  FaTwitter,
  FaUsers,
  FaVideo,
  FaXbox,
} from "react-icons/fa6";
import {
  SiAndroid,
  SiApplemusic,
  SiBaidu,
  SiBandcamp,
  SiBehance,
  SiBilibili,
  SiBitbucket,
  SiBluesky,
  SiBlogger,
  SiBuymeacoffee,
  SiCodeberg,
  SiCodeforces,
  SiCodesandbox,
  SiCsdn,
  SiDevdotto,
  SiDiscord,
  SiDocker,
  SiDouban,
  SiDribbble,
  SiEpicgames,
  SiFacebook,
  SiFigma,
  SiGitee,
  SiGithub,
  SiGitlab,
  SiGooglescholar,
  SiHackerrank,
  SiHashnode,
  SiHuggingface,
  SiInstagram,
  SiJuejin,
  SiKaggle,
  SiKakaotalk,
  SiKeybase,
  SiKofi,
  SiKuaishou,
  SiLeetcode,
  SiLine,
  SiLinktree,
  SiMastodon,
  SiMatrix,
  SiMedium,
  SiMessenger,
  SiNeteasecloudmusic,
  SiOrcid,
  SiPatreon,
  SiPinterest,
  SiPlaystation,
  SiQq,
  SiQuora,
  SiReddit,
  SiResearchgate,
  SiRss,
  SiSignal,
  SiSinaweibo,
  SiSnapchat,
  SiSoundcloud,
  SiSpotify,
  SiStackexchange,
  SiStackoverflow,
  SiSteam,
  SiSubstack,
  SiTelegram,
  SiThreads,
  SiTiktok,
  SiTumblr,
  SiTwitch,
  SiV2Ex,
  SiViber,
  SiVimeo,
  SiWechat,
  SiWhatsapp,
  SiWordpress,
  SiX,
  SiXiaohongshu,
  SiXmpp,
  SiYoutube,
  SiZhihu,
  SiZoom,
} from "react-icons/si";
import type { Language } from "./siteLanguage";

export type SocialKind = "external" | "email" | "phone" | "sms" | "qr";

type SocialCatalogEntry<Type extends string = string> = {
  type: Type;
  label: { zh: string; en: string };
  kind: SocialKind;
  icon: IconType;
};

const entry = <Type extends string>(
  type: Type,
  zh: string,
  en: string,
  kind: SocialKind,
  icon: IconType,
): SocialCatalogEntry<Type> => ({ type, label: { zh, en }, kind, icon });

/**
 * The single source of truth for public contact types. Keep its order aligned
 * with the administrator selector so labels and icons stay predictable.
 */
export const SOCIAL_CATALOG = [
  entry("website", "网站", "Website", "external", FaGlobe),
  entry("email", "邮箱", "Email", "email", FaEnvelope),
  entry("phone", "电话", "Phone", "phone", FaPhone),
  entry("sms", "短信", "SMS", "sms", FaCommentSms),
  entry("address", "地址", "Address", "external", FaLocationDot),
  entry("rss", "RSS 订阅", "RSS", "external", SiRss),
  entry("linktree", "Linktree", "Linktree", "external", SiLinktree),
  entry("custom", "自定义链接", "Custom link", "external", FaLink),

  entry("wechat", "微信", "WeChat", "qr", SiWechat),
  entry("wechat-dark", "微信（深色二维码）", "WeChat (dark QR)", "qr", SiWechat),
  entry("wechat-official", "微信公众号", "WeChat Official Account", "qr", SiWechat),
  entry("wechat-channels", "微信视频号", "WeChat Channels", "qr", FaVideo),
  entry("wecom", "企业微信", "WeCom", "qr", FaBuilding),
  entry("qq", "QQ", "QQ", "external", SiQq),
  entry("qq-group", "QQ 群", "QQ Group", "external", FaUsers),
  entry("weibo", "微博", "Weibo", "external", SiSinaweibo),
  entry("bilibili", "哔哩哔哩", "Bilibili", "external", SiBilibili),
  entry("douyin", "抖音", "Douyin", "external", SiTiktok),
  entry("kuaishou", "快手", "Kuaishou", "external", SiKuaishou),
  entry("xiaohongshu", "小红书", "Xiaohongshu", "external", SiXiaohongshu),
  entry("zhihu", "知乎", "Zhihu", "external", SiZhihu),
  entry("douban", "豆瓣", "Douban", "external", SiDouban),
  entry("juejin", "掘金", "Juejin", "external", SiJuejin),
  entry("csdn", "CSDN", "CSDN", "external", SiCsdn),
  entry("segmentfault", "思否", "SegmentFault", "external", FaCode),
  entry("acfun", "AcFun", "AcFun", "external", FaVideo),
  entry("baidu-tieba", "百度贴吧", "Baidu Tieba", "external", SiBaidu),
  entry("coolapk", "酷安", "Coolapk", "external", SiAndroid),
  entry("netease-music", "网易云音乐", "NetEase Cloud Music", "external", SiNeteasecloudmusic),
  entry("feishu", "飞书", "Feishu", "external", FaComments),
  entry("dingtalk", "钉钉", "DingTalk", "external", FaComments),
  entry("yuque", "语雀", "Yuque", "external", FaBookOpen),
  entry("v2ex", "V2EX", "V2EX", "external", SiV2Ex),
  entry("oschina", "开源中国", "OSCHINA", "external", FaCode),
  entry("cnblogs", "博客园", "CNBlogs", "external", FaBookOpen),
  entry("gitee", "Gitee", "Gitee", "external", SiGitee),
  entry("coding", "CODING", "CODING", "external", FaCodeBranch),

  entry("github", "GitHub", "GitHub", "external", SiGithub),
  entry("gitlab", "GitLab", "GitLab", "external", SiGitlab),
  entry("bitbucket", "Bitbucket", "Bitbucket", "external", SiBitbucket),
  entry("codeberg", "Codeberg", "Codeberg", "external", SiCodeberg),
  entry("stackoverflow", "Stack Overflow", "Stack Overflow", "external", SiStackoverflow),
  entry("stackexchange", "Stack Exchange", "Stack Exchange", "external", SiStackexchange),
  entry("leetcode", "力扣", "LeetCode", "external", SiLeetcode),
  entry("codeforces", "Codeforces", "Codeforces", "external", SiCodeforces),
  entry("hackerrank", "HackerRank", "HackerRank", "external", SiHackerrank),
  entry("kaggle", "Kaggle", "Kaggle", "external", SiKaggle),
  entry("huggingface", "Hugging Face", "Hugging Face", "external", SiHuggingface),
  entry("devto", "DEV Community", "DEV Community", "external", SiDevdotto),
  entry("hashnode", "Hashnode", "Hashnode", "external", SiHashnode),
  entry("codepen", "CodePen", "CodePen", "external", FaCodepen),
  entry("codesandbox", "CodeSandbox", "CodeSandbox", "external", SiCodesandbox),
  entry("dockerhub", "Docker Hub", "Docker Hub", "external", SiDocker),

  entry("x", "X", "X", "external", SiX),
  entry("twitter", "Twitter", "Twitter", "external", FaTwitter),
  entry("facebook", "Facebook", "Facebook", "external", SiFacebook),
  entry("instagram", "Instagram", "Instagram", "external", SiInstagram),
  entry("threads", "Threads", "Threads", "external", SiThreads),
  entry("bluesky", "Bluesky", "Bluesky", "external", SiBluesky),
  entry("mastodon", "Mastodon", "Mastodon", "external", SiMastodon),
  entry("linkedin", "领英", "LinkedIn", "external", FaLinkedin),
  entry("youtube", "YouTube", "YouTube", "external", SiYoutube),
  entry("tiktok", "TikTok", "TikTok", "external", SiTiktok),
  entry("twitch", "Twitch", "Twitch", "external", SiTwitch),
  entry("vimeo", "Vimeo", "Vimeo", "external", SiVimeo),
  entry("reddit", "Reddit", "Reddit", "external", SiReddit),
  entry("pinterest", "Pinterest", "Pinterest", "external", SiPinterest),
  entry("tumblr", "Tumblr", "Tumblr", "external", SiTumblr),
  entry("snapchat", "Snapchat", "Snapchat", "external", SiSnapchat),
  entry("quora", "Quora", "Quora", "external", SiQuora),
  entry("medium", "Medium", "Medium", "external", SiMedium),
  entry("substack", "Substack", "Substack", "external", SiSubstack),
  entry("wordpress", "WordPress", "WordPress", "external", SiWordpress),
  entry("blogger", "Blogger", "Blogger", "external", SiBlogger),

  entry("telegram", "Telegram", "Telegram", "external", SiTelegram),
  entry("discord", "Discord", "Discord", "external", SiDiscord),
  entry("whatsapp", "WhatsApp", "WhatsApp", "external", SiWhatsapp),
  entry("signal", "Signal", "Signal", "external", SiSignal),
  entry("line", "LINE", "LINE", "external", SiLine),
  entry("kakaotalk", "KakaoTalk", "KakaoTalk", "external", SiKakaotalk),
  entry("viber", "Viber", "Viber", "external", SiViber),
  entry("skype", "Skype", "Skype", "external", FaSkype),
  entry("messenger", "Messenger", "Messenger", "external", SiMessenger),
  entry("matrix", "Matrix", "Matrix", "external", SiMatrix),
  entry("slack", "Slack", "Slack", "external", FaSlack),
  entry("microsoft-teams", "Microsoft Teams", "Microsoft Teams", "external", FaMicrosoft),
  entry("zoom", "Zoom", "Zoom", "external", SiZoom),
  entry("keybase", "Keybase", "Keybase", "external", SiKeybase),
  entry("irc", "IRC", "IRC", "external", FaHashtag),
  entry("xmpp", "XMPP", "XMPP", "external", SiXmpp),

  entry("spotify", "Spotify", "Spotify", "external", SiSpotify),
  entry("apple-music", "Apple Music", "Apple Music", "external", SiApplemusic),
  entry("soundcloud", "SoundCloud", "SoundCloud", "external", SiSoundcloud),
  entry("bandcamp", "Bandcamp", "Bandcamp", "external", SiBandcamp),
  entry("steam", "Steam", "Steam", "external", SiSteam),
  entry("epic-games", "Epic Games", "Epic Games", "external", SiEpicgames),
  entry("playstation", "PlayStation", "PlayStation", "external", SiPlaystation),
  entry("xbox", "Xbox", "Xbox", "external", FaXbox),

  entry("dribbble", "Dribbble", "Dribbble", "external", SiDribbble),
  entry("behance", "Behance", "Behance", "external", SiBehance),
  entry("figma", "Figma", "Figma", "external", SiFigma),
  entry("patreon", "Patreon", "Patreon", "external", SiPatreon),
  entry("ko-fi", "Ko-fi", "Ko-fi", "external", SiKofi),
  entry("buy-me-a-coffee", "Buy Me a Coffee", "Buy Me a Coffee", "external", SiBuymeacoffee),
  entry("orcid", "ORCID", "ORCID", "external", SiOrcid),
  entry("researchgate", "ResearchGate", "ResearchGate", "external", SiResearchgate),
  entry("google-scholar", "谷歌学术", "Google Scholar", "external", SiGooglescholar),
] as const;

export type KnownSocialType = (typeof SOCIAL_CATALOG)[number]["type"];

/** Known values retain autocomplete while arbitrary legacy strings still render safely. */
export type SocialType = KnownSocialType | (string & {});

const catalogByType = new Map<string, SocialCatalogEntry>(
  SOCIAL_CATALOG.map((item) => [item.type, item]),
);

function unknownLabel(type: string): string {
  const normalized = String(type || "").trim();
  if (!normalized) return "Link";
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getSocialDefinition(type: SocialType): SocialCatalogEntry {
  const normalized = String(type || "");
  return (
    catalogByType.get(normalized) || {
      type: normalized,
      label: { zh: unknownLabel(normalized), en: unknownLabel(normalized) },
      kind: "external",
      icon: FaLink,
    }
  );
}

export function getSocialLabel(type: SocialType, language: Language): string {
  return getSocialDefinition(type).label[language];
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function safeHttpUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || hasControlCharacters(trimmed)) return undefined;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? trimmed
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveProtocolValue(
  value: string,
  protocol: "mailto:" | "tel:" | "sms:",
  barePattern: RegExp,
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || hasControlCharacters(trimmed)) return undefined;
  const lower = trimmed.toLowerCase();
  const payload = lower.startsWith(protocol)
    ? trimmed.slice(protocol.length)
    : trimmed;
  if (!payload || !barePattern.test(payload)) return undefined;
  return `${protocol}${payload}`;
}

/** Resolve a clickable target. Returning undefined deliberately renders inert UI. */
export function resolveSocialHref(
  type: SocialType,
  value: string,
): string | undefined {
  const definition = getSocialDefinition(type);
  if (definition.kind === "qr") return undefined;
  if (definition.kind === "email") {
    return resolveProtocolValue(
      value,
      "mailto:",
      /^[^\s@?]+@[^\s@?]+(?:\?[^\s]*)?$/,
    );
  }
  if (definition.kind === "phone") {
    return resolveProtocolValue(value, "tel:", /^[+\d().\- *#]+$/);
  }
  if (definition.kind === "sms") {
    return resolveProtocolValue(value, "sms:", /^[+\d().\- *#]+$/);
  }
  return safeHttpUrl(value);
}

export function resolveSocialQrSource(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || hasControlCharacters(trimmed)) return undefined;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.includes("\\")) {
    return trimmed;
  }
  return safeHttpUrl(trimmed);
}
