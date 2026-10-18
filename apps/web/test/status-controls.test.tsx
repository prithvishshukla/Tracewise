import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusControls } from '@/components/status-controls';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe('StatusControls', () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.restoreAllMocks();
  });

  it('shows all four statuses and marks the current one as pressed', () => {
    render(<StatusControls findingId="f1" status="open" />);
    for (const name of ['Open', 'Snoozed', 'Fixed', 'False positive']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Fixed' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('PATCHes the finding through the API and updates the UI', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => ok({ status: 'fixed' }));
    render(<StatusControls findingId="abc" status="open" />);
    await userEvent.click(screen.getByRole('button', { name: 'Fixed' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fixed' })).toHaveAttribute('aria-pressed', 'true'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/findings/abc',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'fixed' }) }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('snoozing sends a snooze duration', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => ok({}));
    render(<StatusControls findingId="abc" status="open" />);
    await userEvent.click(screen.getByRole('button', { name: 'Snoozed' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ status: 'snoozed', snoozeDays: 7 });
  });

  it('shows the server error and keeps the previous status when saving fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { message: 'Finding not found' } }), { status: 404 })),
    );
    render(<StatusControls findingId="abc" status="open" />);
    await userEvent.click(screen.getByRole('button', { name: 'False positive' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Finding not found');
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does nothing when the current status is clicked', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    render(<StatusControls findingId="abc" status="fixed" />);
    await userEvent.click(screen.getByRole('button', { name: 'Fixed' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
