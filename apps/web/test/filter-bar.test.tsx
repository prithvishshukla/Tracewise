import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterBar } from '@/components/filter-bar';

const replace = vi.fn();
let search = 'page=3&status=open';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/findings',
  useSearchParams: () => new URLSearchParams(search),
}));

const fields = [
  { name: 'q', label: 'Search', type: 'search' as const },
  {
    name: 'severity',
    label: 'Severity',
    type: 'select' as const,
    options: [
      { value: 'high', label: 'High' },
      { value: 'low', label: 'Low' },
    ],
  },
  { name: 'status', label: 'Status', type: 'select' as const, options: [{ value: 'open', label: 'Open' }] },
];

describe('FilterBar', () => {
  beforeEach(() => {
    replace.mockClear();
    search = 'page=3&status=open';
  });

  it('reflects the current URL state', () => {
    render(<FilterBar fields={fields} />);
    expect(screen.getByLabelText('Status')).toHaveValue('open');
    expect(screen.getByLabelText('Severity')).toHaveValue('');
  });

  it('selecting a filter updates the URL and resets pagination', async () => {
    render(<FilterBar fields={fields} />);
    await userEvent.selectOptions(screen.getByLabelText('Severity'), 'high');
    expect(replace).toHaveBeenCalledWith('/findings?status=open&severity=high');
  });

  it('clearing a filter removes it from the URL', async () => {
    render(<FilterBar fields={fields} />);
    await userEvent.selectOptions(screen.getByLabelText('Status'), '');
    expect(replace).toHaveBeenCalledWith('/findings');
  });

  it('search is debounced and trimmed', async () => {
    render(<FilterBar fields={fields} />);
    await userEvent.type(screen.getByLabelText('Search'), ' stripe ');
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1), { timeout: 1500 });
    expect(replace).toHaveBeenCalledWith('/findings?status=open&q=stripe');
  });
});
