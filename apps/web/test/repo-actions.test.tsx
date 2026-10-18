import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterRepoForm, ScanButton } from '@/components/repo-actions';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('RegisterRepoForm', () => {
  beforeEach(() => {
    push.mockClear();
    vi.restoreAllMocks();
  });
  it('submits the repository and navigates to its page', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(() => json({ id: 'r1' }, 201));
    render(<RegisterRepoForm />);
    await userEvent.type(screen.getByLabelText(/Absolute path/), '/repos/app');
    await userEvent.click(screen.getByRole('button', { name: /Register/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/repositories/r1'));
    expect(JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ sourceType: 'local', location: '/repos/app' });
  });
  it('shows API validation errors (for example an unsafe path) and does not navigate', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      json({ error: { message: 'Directory is outside the allowed scan roots (see SCAN_ROOTS)' } }, 400),
    );
    render(<RegisterRepoForm />);
    await userEvent.type(screen.getByLabelText(/Absolute path/), '/etc');
    await userEvent.click(screen.getByRole('button', { name: /Register/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('outside the allowed scan roots');
    expect(push).not.toHaveBeenCalled();
  });
  it('explains that the browser cannot read the local disk', () => {
    render(<RegisterRepoForm />);
    expect(screen.getByText(/browser cannot read your disk/)).toBeInTheDocument();
  });
  it('register is disabled until a location is entered, and git mode changes the label', async () => {
    render(<RegisterRepoForm />);
    expect(screen.getByRole('button', { name: /Register/ })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Source'), 'git');
    expect(screen.getByLabelText(/github.com\/owner\/repo/)).toBeInTheDocument();
  });
});

describe('ScanButton', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    refresh.mockClear();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('starts a scan and polls until it succeeds, then refreshes the page', async () => {
    const scan = (status: string) => ({ id: 's1', status, filesIndexed: 7, callSitesCount: 4, error: null });
    let polls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url).endsWith('/scan')) return json({ scan: scan('queued'), deduplicated: false }, 202);
      polls++;
      return json(scan(polls < 2 ? 'running' : 'succeeded'));
    });
    render(<ScanButton repositoryId="r1" />);
    await userEvent.click(screen.getByRole('button', { name: /Scan now/ }));
    expect(screen.getByRole('button', { name: /Scanning/ })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await waitFor(() => expect(screen.getByText(/Scan finished: 7 files, 4 call sites/)).toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Scan now/ })).toBeEnabled();
  });
  it('reports a failed scan', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) =>
      String(url).endsWith('/scan')
        ? json({ scan: { id: 's1', status: 'queued' } }, 202)
        : json({ id: 's1', status: 'failed', error: 'Directory does not exist or is not accessible' }),
    );
    render(<ScanButton repositoryId="r1" />);
    await userEvent.click(screen.getByRole('button', { name: /Scan now/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    await waitFor(() => expect(screen.getByText(/Scan failed: Directory does not exist/)).toBeInTheDocument());
  });
  it('shows an error when the scan cannot be started', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      json({ error: { message: 'Could not enqueue the scan job. Is Redis running?' } }, 409),
    );
    render(<ScanButton repositoryId="r1" />);
    await userEvent.click(screen.getByRole('button', { name: /Scan now/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Is Redis running');
  });
});
