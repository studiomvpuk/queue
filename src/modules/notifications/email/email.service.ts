import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (apiKey) {
      this.resend = new Resend(apiKey);
    }
  }

  async sendOtp(email: string, code: string): Promise<void> {
    const from = this.config.get<string>('RESEND_FROM_EMAIL') ?? 'QueueEase <noreply@queueease.com>';

    if (!this.resend) {
      this.logger.warn(`[DEV EMAIL] to=${email} code=${code}`);
      return;
    }

    try {
      await this.resend.emails.send({
        from,
        to: email,
        subject: `${code} is your QueueEase verification code`,
        html: `
          <div style="font-family: Inter, -apple-system, sans-serif; max-width: 400px; margin: 0 auto; padding: 32px;">
            <h2 style="color: #111111; margin-bottom: 8px;">Your verification code</h2>
            <div style="font-size: 36px; font-weight: 700; letter-spacing: 6px; color: #1F6BFF; padding: 24px 0; text-align: center; background: #F5F5F5; border-radius: 12px; margin: 16px 0;">
              ${code}
            </div>
            <p style="color: #666; font-size: 14px; line-height: 1.5;">
              This code expires in 5 minutes. If you didn't request this, you can safely ignore it.
            </p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
            <p style="color: #999; font-size: 12px;">QueueEase — skip the queues</p>
          </div>
        `,
      });
      this.logger.log(`OTP email sent to ${email.slice(0, 3)}***`);
    } catch (err) {
      this.logger.error(`Resend email failed: ${(err as Error).message}`);
      throw err;
    }
  }
}
