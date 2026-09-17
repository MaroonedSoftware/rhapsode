#!/usr/bin/env node
/** The composition root. It wires modules together and owns nothing else. */

import { CONTRACT_MAJOR } from '@rhapsode/core';

console.log(JSON.stringify({ level: 'info', message: 'rhapsode', contract: CONTRACT_MAJOR }));
