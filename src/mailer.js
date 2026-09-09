import nodemailer from 'nodemailer';
export function createMailer(config) {
  const transport = nodemailer.createTransport(config.smtp);
  return { sendMail: message => transport.sendMail({ from: config.mailFrom, ...message }), close: () => transport.close() };
}
