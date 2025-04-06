// src/mail/mail.service.ts
import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as crypto from 'crypto-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { compile } from 'handlebars';

@Injectable()
export class MailService {
  private transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'Gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
  randomCode = Math.random().toString(36).substring(2, 8);

  private readonly templateDir = join(__dirname, '../../email-templates');

  private loadTemplate(templateName: string): string {
    // Try dist folder first (production)
    const distPath = join(
      process.cwd(),
      'dist',
      'email-templates',
      `${templateName}.hbs`,
    );

    // Fallback to source templates (development)
    const srcPath = join(
      process.cwd(),
      'email-templates',
      `${templateName}.hbs`,
    );

    try {
      return readFileSync(distPath, 'utf-8');
    } catch {
      try {
        return readFileSync(srcPath, 'utf-8');
      } catch {
        throw new Error(
          `Template ${templateName} not found in either:\n` +
            `- ${distPath}\n` +
            `- ${srcPath}`,
        );
      }
    }
  }

  async sendVerificationEmail(email: string, name: string, token: string) {
    const randomCode = Math.random().toString(36).substring(2, 8);
    const template = this.loadTemplate('verification-email');
    const html = compile(template)({
      name,
      verificationLink: `${process.env.FRONTEND_URL}/verify-email?token=${token}`,
      currentYear: new Date().getFullYear(),
      appName: process.env.APP_NAME,
      randomCode,
    });

    try {
      await this.transporter.sendMail({
        from: `"${process.env.APP_NAME}" <${process.env.EMAIL_FROM}>`,
        to: email,
        subject: `Verify Your Email for ${process.env.APP_NAME}`,
        html,
        headers: {
          'List-Unsubscribe': `<mailto:unsubscribe@yourdomain.com?subject=Unsubscribe>`,
          'X-Mailer': 'NestJS Mailer',
          'X-Priority': '1',
          Precedence: 'bulk',
        },
      });
      console.log(`Verification email sent to ${email}`);
    } catch (error) {
      console.error('Error sending verification email:', error);
      throw new Error('Failed to send verification email');
    }
  }

  async sendPasswordResetEmail(email: string, name: string, token: string) {
    // const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    const template = this.loadTemplate('reset-password');

    const html = compile(template)({
      name,
      resetLink: `${process.env.FRONTEND_URL}/reset-password?token=${token}`,
      randomCode: Math.random().toString(36).substring(2, 8),
      date: new Date().toISOString(),
      appName: process.env.APP_NAME,
      year: new Date().getFullYear(),
      supportLink: `${process.env.FRONTEND_URL}/contact`,
      privacyLink: `${process.env.FRONTEND_URL}/privacy`,
      // unsubscribeLink: `${process.env.FRONTEND_URL}/unsubscribe`,
    });

    // await this.transporter.sendMail({
    //   from: `"CRM Team" <${process.env.EMAIL_USER}>`,
    //   to: email,
    //   subject: 'Password Reset Request',
    //   html: `<p>Click <a href="${resetUrl}">here</a> to reset your password.</p>`,
    // });

    try {
      await this.transporter.sendMail({
        from: `"${process.env.APP_NAME}" <${process.env.EMAIL_FROM}>`,
        to: email,
        subject: `Reset Your Password for ${process.env.APP_NAME}`,
        html,
      });
      console.log(`Password reset email sent to ${email}`);
    } catch (error) {
      console.error('Error sending password reset email:', error);
      throw new Error('Failed to send password reset email');
    }
  }

  generateToken() {
    return crypto.lib.WordArray.random(32).toString();
  }
}
