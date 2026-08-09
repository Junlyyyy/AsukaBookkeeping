// AsukaCapture 原生插件的 TypeScript 类型

export interface SmsItem {
  /** 发件号码（如 95588 工商银行） */
  sender: string;
  /** 短信正文（已拆行/未加工） */
  body: string;
  /** 短信接收时刻的毫秒时间戳 */
  date: number;
}

export interface SmsQueryResult {
  items: SmsItem[];
  count: number;
}

export interface NotificationAccessStatus {
  granted: boolean;
}

export interface NotificationPayload {
  /** 发起通知的应用包名（白名单过滤后） */
  packageName: string;
  title: string;
  text: string;
  /** title + text 拼接的明文（解析用） */
  body: string;
  postedAt: number;
  key: string;
}

export interface AsukaCapturePlugin {
  /** 读取自 sinceMs 之后的收件箱短信。无权限会自动请求。 */
  readRecentSms(options?: { sinceMs?: number }): Promise<SmsQueryResult>;
  /** 检查用户是否已在系统「通知使用权」中授权给本 App */
  isNotificationAccessGranted(): Promise<NotificationAccessStatus>;
  /** 拉起系统「通知使用权」设置页（让用户勾选） */
  openNotificationAccessSettings(): Promise<{ opened: boolean }>;
  /** 注册通知监听回调（每次系统通知栏有匹配通知时触发） */
  addListener(
    eventName: 'notification_captured',
    listenerFunc: (payload: NotificationPayload) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}
