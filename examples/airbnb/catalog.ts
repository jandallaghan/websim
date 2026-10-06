/** Captured quotes, not a model of Airbnb's live inventory or pricing. */
export const stays = [
  {
    id: "1172994310245519962",
    city: "Paris",
    placeId: "ChIJD7fiBh9u5kcRYJSMaMOCCwQ",
    checkin: "2026-11-10",
    checkout: "2026-11-13",
    adults: 2,
  },
  {
    id: "1760085343933645112",
    city: "London",
    placeId: "ChIJdd4hrwug2EcRmSrV3Vo6llI",
    checkin: "2026-11-01",
    checkout: "2026-11-06",
    adults: 1,
  },
] as const;
export type Stay = (typeof stays)[number];
