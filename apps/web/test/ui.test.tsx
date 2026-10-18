import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CodeSnippet, ConfidenceMeter, DemoBadge, EmptyState, ErrorState, ImpactBadge, Pagination, SeverityBadge } from '@/components/ui';

describe('UI primitives', () => {
  it('ImpactBadge distinguishes verified from possible impacts', () => {
    const { rerender } = render(<ImpactBadge confidence={0.95} />);
    expect(screen.getByText('Verified')).toBeInTheDocument();
    rerender(<ImpactBadge confidence={0.55} />);
    expect(screen.getByText('Possible')).toBeInTheDocument();
    expect(screen.getByText('Possible')).toHaveAttribute('title', expect.stringMatching(/not a confirmed impact/));
  });
  it('DemoBadge explains that data is simulated', () => {
    render(<DemoBadge />);
    expect(screen.getByText('DEMO DATA').closest('span')).toHaveAttribute('title', expect.stringMatching(/Simulated/));
  });
  it('SeverityBadge shows the label', () => {
    render(<SeverityBadge severity="critical" />);
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });
  it('ConfidenceMeter exposes an accessible label', () => {
    render(<ConfidenceMeter value={0.35} />);
    expect(screen.getByRole('img', { name: 'Confidence 35%' })).toBeInTheDocument();
  });
  it('CodeSnippet numbers lines from the start line', () => {
    const { container } = render(<CodeSnippet code={'a\nb\nc'} startLine={8} highlightLine={9} />);
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(container.querySelectorAll('span.flex')).toHaveLength(3);
    expect(container.querySelectorAll('.shadow-\\[inset_3px_0_0_\\#f87171\\]')).toHaveLength(1);
  });
  it('Pagination renders previous/next links only where applicable', () => {
    const href = (p: number) => `/x?page=${p}`;
    const { rerender } = render(<Pagination page={1} totalPages={3} total={50} hrefFor={href} />);
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/x?page=2');
    expect(screen.queryByRole('link', { name: 'Previous' })).toBeNull();
    rerender(<Pagination page={3} totalPages={3} total={50} hrefFor={href} />);
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/x?page=2');
    rerender(<Pagination page={1} totalPages={1} total={1} hrefFor={href} />);
    expect(screen.getByText('1 result')).toBeInTheDocument();
  });
  it('EmptyState and ErrorState render their messages', () => {
    render(
      <>
        <EmptyState title="Nothing here" description="Try later" />
        <ErrorState message="Boom" />
      </>,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
  });
});
