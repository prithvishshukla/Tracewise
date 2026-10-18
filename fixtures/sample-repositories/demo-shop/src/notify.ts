const TWILIO_BASE = 'https://api.twilio.com/2010-04-01';

export async function sendSms(accountSid: string, to: string, body: string) {
  const url = `${TWILIO_BASE}/Accounts/${accountSid}/Messages.json`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, Body: body }),
  });
}
