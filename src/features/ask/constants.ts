export const ASK_PLACEHOLDER =
  'I lose $500 if it rains during my beach wedding in Miami on March 21.'

export interface ExampleChip {
  readonly label: string
  readonly prompt: string
}

/** Tappable examples on the Ask screen (spec §2, screen 1). */
export const EXAMPLE_CHIPS: readonly ExampleChip[] = [
  {
    label: '☔️ Rain on my event',
    prompt:
      'I lose $500 if it rains during my beach wedding in Miami on March 21.',
  },
  {
    label: '📉 BTC drops',
    prompt: 'I hold 0.5 BTC and I am worried it falls below $60k this month.',
  },
  {
    label: '🗳️ Election outcome',
    prompt: 'My business loses money if the incumbent loses the election.',
  },
  {
    label: '🏈 My team loses',
    prompt: 'I lose a $200 bet with a friend if the Chiefs miss the playoffs.',
  },
]
