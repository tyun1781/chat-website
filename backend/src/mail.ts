import nodemailer from 'nodemailer';

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface Mailer {
  sendVerificationCode(to: string, code: string, minutes: number): Promise<void>;
}

/**
 * 没有配置 SMTP 时返回 null：站点照常运行，只关闭注册（/api/auth/email-code 会返回 503），
 * 这样运维漏配一个环境变量不会把整个站搞挂。
 */
export function createMailer(config: MailConfig | null): Mailer | null {
  if (!config) return null;
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    async sendVerificationCode(to, code, minutes) {
      await transport.sendMail({
        from: config.from,
        to,
        subject: '【INCH】邮箱验证码',
        text: [
          `你的验证码是 ${code}，${minutes} 分钟内有效。`,
          '',
          '如果这不是你本人的操作，请忽略本邮件，你的邮箱不会发生任何变化。',
          '—— INCH',
        ].join('\n'),
        html: `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.7;color:#22303c">
  <p>欢迎来到 INCH，你的验证码是：</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>
  <p style="color:#5a6b7b">验证码 ${minutes} 分钟内有效，请勿转发给他人。</p>
  <p style="color:#8a97a3;font-size:13px">如果这不是你本人的操作，请忽略本邮件，你的邮箱不会发生任何变化。</p>
</div>`.trim(),
      });
    },
  };
}
