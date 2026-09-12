import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider, type Locale } from '../i18n';
import { TripShareCard } from '../components/TripShareCard';
import { DEPARTURE, NOW, makeResponse, makeTrip } from './fixtures';
import type { ApprovedMember } from '../lib/types';

/**
 * The shared picture is not a crop of the home screen: the tally of counts and
 * the buttons are gone, and in their place is the whole group — everybody
 * travelling under the departure they chose, then the ones who declined, then
 * the ones who never answered. These tests hold that shape.
 */

vi.mock('../lib/push', () => ({
  pushState: () => 'unsupported',
  enablePush: vi.fn(),
  touchExistingToken: vi.fn(),
  registerOfflineWorker: vi.fn(),
}));

const approved = (uid: string, displayName: string): ApprovedMember => ({
  uid,
  displayName,
  approvedAt: NOW,
  approvedBy: 'org',
});

// 06:00 Tirana on the 24th, plus a later slot and a "maybe".
const LATER = new Date('2026-09-24T06:30:00.000Z');

const RESPONSES = [
  makeResponse('u1', 'Besi', 'yes'),
  makeResponse('u2', 'Ana', 'yes'),
  makeResponse('u3', 'Dritan', 'yes', LATER),
  makeResponse('u4', 'Erjon', 'maybe', LATER),
  makeResponse('u5', 'Gentian', 'no'),
];

/** The approved group: the five who answered, plus two who never did. */
const ROSTER = [
  approved('u1', 'Besi'),
  approved('u2', 'Ana'),
  approved('u3', 'Dritan'),
  approved('u4', 'Erjon'),
  approved('u5', 'Gentian'),
  approved('u6', 'Sokol'),
  approved('u7', 'Jafja'),
];

function renderCard(
  locale: Locale,
  responses: typeof RESPONSES = RESPONSES,
  members: ApprovedMember[] = ROSTER,
) {
  localStorage.setItem('piqeras.locale', locale);
  return render(
    <I18nProvider>
      <TripShareCard
        trip={makeTrip()}
        departure={DEPARTURE}
        now={NOW}
        responses={responses}
        members={members}
      />
    </I18nProvider>,
  );
}

/** The departure rows only — not the "not coming" / "no answer" rows. */
const travel = (c: HTMLElement) => [
  ...c.querySelectorAll('.share-slot:not(.share-slot--aside)'),
];

/** One of the two trailing rows, found by its label. */
const aside = (c: HTMLElement, label: string) =>
  [...c.querySelectorAll('.share-slot--aside')].find(
    (el) => el.querySelector('.share-slot__label')?.textContent === label,
  );

beforeEach(() => {
  localStorage.clear();
});

describe('who is travelling', () => {
  test('everybody is listed under the time they chose', () => {
    const { container } = renderCard('sq');
    const slots = travel(container);
    expect(slots).toHaveLength(2);

    expect(slots[0].querySelector('.share-slot__time')!.textContent).toBe('06:00');
    expect(slots[0].querySelector('.share-slot__names')!.textContent).toBe('Ana · Besi');

    expect(slots[1].querySelector('.share-slot__time')!.textContent).toBe('08:30');
    expect(slots[1].querySelector('.share-slot__names')!.textContent).toContain('Dritan');
  });

  test('each group carries its own date, not just a time', () => {
    const { container } = renderCard('sq');
    for (const slot of travel(container)) {
      expect(slot.querySelector('.share-slot__day')!.textContent).toBe('24 Shtator');
    }
  });

  test('a "maybe" is included but marked as one', () => {
    const { container } = renderCard('sq');
    expect(travel(container)[1].textContent).toContain('Erjon (Ndoshta)');
  });

  test('someone travelling without a chosen time is still shown, last', () => {
    const { container } = renderCard(
      'sq',
      [makeResponse('u1', 'Besi', 'yes'), makeResponse('u7', 'Jafja', 'maybe', null)],
      [approved('u1', 'Besi'), approved('u7', 'Jafja')],
    );
    const slots = travel(container);
    expect(slots).toHaveLength(2);
    expect(slots[1].textContent).toContain('Jafja');
    expect(slots[1].querySelector('.share-slot__day')!.textContent).toBe(
      'Ora e nisjes nuk dihet',
    );
  });

  test('the head count counts only the people travelling', () => {
    // Four of the five who answered: three yes and one maybe. Not the person
    // who declined, and not the two who never replied.
    renderCard('sq');
    expect(screen.getByText('4 veta')).toBeInTheDocument();
  });
});

describe('the rest of the group', () => {
  test('somebody who declined is named, away from the departures', () => {
    const { container } = renderCard('sq');
    const no = aside(container, 'Nuk vijnë')!;
    expect(no).toBeDefined();
    expect(no.textContent).toContain('Gentian');
    for (const slot of travel(container)) {
      expect(slot.textContent).not.toContain('Gentian');
    }
  });

  test('the people who never voted are named too', () => {
    // The point of the section: the card answers "who is still missing?"
    const silent = aside(renderCard('sq').container, 'Pa përgjigje')!;
    expect(silent).toBeDefined();
    expect(silent.textContent).toContain('Jafja');
    expect(silent.textContent).toContain('Sokol');
  });

  test('a member who answered never shows up as silent', () => {
    const silent = aside(renderCard('sq').container, 'Pa përgjigje')!;
    for (const name of ['Besi', 'Ana', 'Dritan', 'Erjon', 'Gentian']) {
      expect(silent.textContent, name).not.toContain(name);
    }
  });

  test('nobody outside the approved roster is ever named', () => {
    // `users` also holds accounts still waiting for approval; a stranger's name
    // on a card the group forwards would leak who is knocking at the door.
    const { container } = renderCard('sq', RESPONSES, [
      approved('u1', 'Besi'),
      approved('u6', 'Sokol'),
    ]);
    expect(container.textContent).toContain('Sokol');
    expect(container.textContent).not.toContain('Jafja');
  });

  test('a section with nobody in it is left out, not shown empty', () => {
    const { container } = renderCard(
      'sq',
      [makeResponse('u1', 'Besi', 'yes')],
      [approved('u1', 'Besi')],
    );
    expect(container.querySelectorAll('.share-slot--aside')).toHaveLength(0);
  });

  test('everyone silent still produces a card that says so', () => {
    const { container } = renderCard('sq', [], [approved('u6', 'Sokol')]);
    expect(travel(container)).toHaveLength(0);
    expect(container.textContent).toContain('Ende asnjë përgjigje.');
    expect(aside(container, 'Pa përgjigje')!.textContent).toContain('Sokol');
  });
});

describe('the card as a picture', () => {
  test('the tally of counts and the buttons are gone', () => {
    // The reason for a composed card over a screenshot: a photograph of
    // buttons is not something anybody can tap.
    const { container } = renderCard('sq');
    expect(container.querySelector('.chip--yes')).toBeNull();
    expect(container.querySelector('.chip--no')).toBeNull();
    expect(container.querySelector('.chip--none')).toBeNull();
    expect(container.querySelectorAll('a, button, input')).toHaveLength(0);
  });

  test('it keeps the countdown and the full date above the list', () => {
    const { container } = renderCard('sq');
    expect(container.querySelector('.countdown')).not.toBeNull();
    expect(container.textContent).toContain('E enjte, 24 Shtator 2026, 06:00');
  });

  test('a Greek reader gets Greek words, Greek months and the Greek clock', () => {
    const { container } = renderCard('el');
    expect(container.textContent).toContain('Ποιοι φεύγουν και πότε');
    expect(container.textContent).toContain('Δεν έρχονται');
    expect(container.textContent).toContain('Χωρίς απάντηση');
    const first = travel(container)[0];
    expect(first.querySelector('.share-slot__day')!.textContent).toBe('24 Σεπτεμβρίου');
    // 06:00 in Tirana is 07:00 in Athens.
    expect(first.querySelector('.share-slot__time')!.textContent).toBe('07:00');
  });

  test('the grouping does not change with the reader, only the labels', () => {
    // Keyed in the trip's own zone: two people on one departure must not split
    // into separate rows just because somebody reads the card in Greek.
    const sq = travel(renderCard('sq').container).length;
    localStorage.clear();
    const el = travel(renderCard('el').container).length;
    expect(el).toBe(sq);
  });
});
