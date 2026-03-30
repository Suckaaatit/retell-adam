import Stripe from 'stripe';
import { config } from './config';

/**
 * Stripe client. API version pinned for stability.
 * All Stripe API calls MUST include idempotency keys tied to the logical transaction
 * (e.g., call_id or payment attempt ID), NOT random UUIDs.
 */
export const stripe = new Stripe(config.stripe.secretKey.trim(), {
  apiVersion: '2026-02-25.clover',
});
