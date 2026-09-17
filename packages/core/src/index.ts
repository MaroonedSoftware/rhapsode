/**
 * The rhapsode core: routing, worker supervision and model residency.
 *
 * It never imports torch and holds no engine knowledge, which is the rule the whole design rests
 * on. Everything model-shaped lives behind a worker.
 */

export { CONTRACT_MAJOR } from '@rhapsode/contract';
