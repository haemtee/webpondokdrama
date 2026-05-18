// Aggregated provider adapter registry.

import { bilitv, dramabite, rapidtv } from './group1.js';
import { dramawave, freereels } from './group2.js';
import { flickreels, stardusttv } from './group3.js';
import { cubetv, flextv, vigloo, sereal, sarostv } from './group4.js';
import { melolo, moboreels, netshort, pinedrama, reelife } from './group5.js';
import { reelshort, snackshort, starshort, velolo } from './group6.js';

// Backward-compat alias used by existing routes (provider name was "stardust"
// while folder name is "stardusttv").
const stardust = stardusttv;

export const adapters = {
    bilitv,
    cubetv,
    dramabite,
    dramawave,
    flextv,
    flickreels,
    freereels,
    melolo,
    moboreels,
    netshort,
    pinedrama,
    rapidtv,
    reelife,
    reelshort,
    sarostv,
    sereal,
    snackshort,
    stardust,
    stardusttv,
    starshort,
    velolo,
    vigloo
};
