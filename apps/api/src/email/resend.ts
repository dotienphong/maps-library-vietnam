import type { EmailEnv, EmailPort, ThuGui } from './port';

export function resendPort(env: EmailEnv, fetchImpl: typeof fetch = fetch): EmailPort {
  return {
    ten: 'resend',
    async send(thu: ThuGui) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [thu.to],
          reply_to: env.SUPPORT_EMAIL,
          subject: thu.subject,
          html: thu.html,
          text: thu.text,
        }),
      });
      if (!res.ok) {
        // KHÔNG đưa nội dung phản hồi vào message: nó có thể chứa địa chỉ của khách, mà message
        // thì đi thẳng vào log.
        throw new Error(`email_send_failed_${res.status}`);
      }
      const body = (await res.json()) as { id?: string };
      return { id: body.id ?? '' };
    },
  };
}
