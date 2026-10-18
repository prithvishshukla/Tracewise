import { ProviderConfigSchema, type ProviderConfig } from '@tracewise/shared';
import github from '../catalog/github.json';
import openai from '../catalog/openai.json';
import stripe from '../catalog/stripe.json';
import twilio from '../catalog/twilio.json';

/** Provider catalog: data-driven configuration validated at load time. Add a provider by adding a JSON file here. */
export const PROVIDER_CATALOG: ProviderConfig[] = [stripe, github, twilio, openai].map((p) => ProviderConfigSchema.parse(p));

export function getProviderConfig(slug: string): ProviderConfig | undefined {
  return PROVIDER_CATALOG.find((p) => p.slug === slug);
}
