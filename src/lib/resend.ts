import { Resend } from 'resend';
import { config } from './config';

/**
 * Resend email client. Requires verified domain with SPF/DKIM/DMARC.
 * Use $20/mo plan minimum (free tier = 100 emails/day, too low for production).
 */
export const resend = new Resend(config.resend.apiKey.trim());
