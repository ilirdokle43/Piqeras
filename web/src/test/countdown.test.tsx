import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Countdown } from '../components/Countdown';
import { I18nProvider } from '../i18n';

const DEPARTURE = new Date('2026-09-24T04:00:00.000Z');

function renderCountdown(now: Date) {
  return render(
    <I18nProvider>
      <Countdown target={DEPARTURE} now={now} />
    </I18nProvider>,
  );
}

describe('<Countdown>', () => {
  test('shows days, hours, minutes and seconds as separate labelled cells', () => {
    const now = new Date(DEPARTURE.getTime() - (((30 * 24 + 9) * 60 + 31) * 60 + 56) * 1000);
    const { container } = renderCountdown(now);

    const cells = container.querySelectorAll('.countdown__cell');
    expect(cells).toHaveLength(4);

    const values = [...container.querySelectorAll('.countdown__value')].map((n) => n.textContent);
    expect(values).toEqual(['30', '09', '31', '56']);

    const labels = [...container.querySelectorAll('.countdown__label')].map((n) => n.textContent);
    expect(labels).toEqual(['Ditë', 'Orë', 'Minuta', 'Sekonda']);
  });

  test('every label lives in its own element, never glued to its number', () => {
    // The reference screenshot rendered "30Days 9Hours"; this is the structural
    // guarantee that cannot happen here.
    const { container } = renderCountdown(new Date(DEPARTURE.getTime() - 90_000));
    for (const cell of container.querySelectorAll('.countdown__cell')) {
      expect(cell.querySelector('.countdown__value')).not.toBeNull();
      expect(cell.querySelector('.countdown__label')).not.toBeNull();
      expect(cell.querySelector('.countdown__value')!.textContent).toMatch(/^\d+$/);
    }
  });

  test('pads hours, minutes and seconds so the layout cannot jitter', () => {
    const now = new Date(DEPARTURE.getTime() - ((1 * 3600 + 2 * 60 + 3) * 1000));
    const { container } = renderCountdown(now);
    const values = [...container.querySelectorAll('.countdown__value')].map((n) => n.textContent);
    expect(values).toEqual(['0', '01', '02', '03']);
  });

  test('shows the Albanian departure message instead of negative numbers', () => {
    renderCountdown(new Date(DEPARTURE.getTime() + 60_000));
    expect(screen.getByText('U nisëm për Piqeras!')).toBeInTheDocument();
    expect(document.querySelectorAll('.countdown__cell')).toHaveLength(0);
  });

  test('switches to the departure message exactly at zero', () => {
    renderCountdown(DEPARTURE);
    expect(screen.getByText('U nisëm për Piqeras!')).toBeInTheDocument();
  });

  test('still counts one second before departure', () => {
    const { container } = renderCountdown(new Date(DEPARTURE.getTime() - 1000));
    expect(container.querySelector('.countdown--past')).toBeNull();
    const values = [...container.querySelectorAll('.countdown__value')].map((n) => n.textContent);
    expect(values).toEqual(['0', '00', '00', '01']);
  });

  test('exposes a timer role whose label omits the seconds', () => {
    const now = new Date(DEPARTURE.getTime() - (((2 * 24 + 3) * 60 + 4) * 60 + 5) * 1000);
    renderCountdown(now);
    const timer = screen.getByRole('timer');
    // Announcing a new value every second would make a screen reader unusable.
    expect(timer).toHaveAttribute('aria-label', '2 Ditë, 3 Orë, 4 Minuta');
    expect(timer.getAttribute('aria-label')).not.toContain('Sekonda');
  });
});
