import { config } from "@/lib/config";
import { withErrorHandling, ok } from "@/app/api/dashboard/_utils";

function maskValue(value: string) {
  if (value.length <= 4) return value;
  return `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function maskUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname;
    if (host.length <= 8) return host;
    return `${host.slice(0, 4)}****${host.slice(-4)}`;
  } catch {
    return maskValue(value);
  }
}

export const maxDuration = 60;

export async function GET() {
  return withErrorHandling("dashboard settings get failed", async () => {
    return ok({
      elevenlabs_agent_id_masked: maskValue(config.elevenlabs.agentId),
      twilio_from_number_masked: maskValue(config.twilio.fromNumber || "Not set"),
      stripe_link_650_masked: maskValue(config.stripe.link650),
      stripe_link_1100_masked: maskValue(config.stripe.link1100),
      stripe_webhook_active: Boolean(config.stripe.webhookSecret),
      supabase_url_masked: maskUrl(config.supabase.url),
      integrations: {
        elevenlabs: Boolean(config.elevenlabs.apiKey),
        twilio: Boolean(config.twilio.accountSid && config.twilio.authToken),
        stripe: Boolean(config.stripe.secretKey),
        resend: Boolean(config.resend.apiKey),
        supabase: Boolean(config.supabase.url && config.supabase.serviceRoleKey),
      },
    });
  });
}
