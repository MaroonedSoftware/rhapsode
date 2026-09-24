import { useId, useState } from 'react';
import Link from '@docusaurus/Link';
import { LINE, render, TARGETS } from '../cues';
import styles from './cue.demo.module.css';

/** Splits the line as a client writes it into words and cues, so the cues can be set apart. */
function Source() {
    return (
        <p className={styles.line}>
            {LINE.split(/(\[[a-z ]+\])/).map((part, index) =>
                index % 2 === 1 ? (
                    <span key={index} className={styles.cue}>
                        {part}
                    </span>
                ) : (
                    part
                ),
            )}
        </p>
    );
}

/**
 * protocol.md § 5, run in the page: one line in the standard vocabulary, and what each build's model
 * is handed once the core has stripped the cues it does not claim and the adapter has translated the
 * rest.
 */
export default function CueDemo() {
    const [targetId, setTargetId] = useState(TARGETS[0]?.id ?? '');
    const name = useId();
    const target = TARGETS.find(candidate => candidate.id === targetId) ?? TARGETS[0];
    if (!target) return undefined;
    const rendering = render(LINE, target);

    return (
        <figure className={styles.demo}>
            <div className={styles.step}>
                <p className={styles.label}>A client writes the line once</p>
                <Source />
            </div>

            <fieldset className={styles.targets}>
                <legend className={styles.label}>and sends it to</legend>
                {TARGETS.map(candidate => (
                    <label key={candidate.id} className={styles.target}>
                        <input
                            type="radio"
                            name={name}
                            value={candidate.id}
                            checked={candidate.id === target.id}
                            onChange={() => setTargetId(candidate.id)}
                        />
                        <span>{candidate.label}</span>
                    </label>
                ))}
            </fieldset>

            <div className={styles.step} aria-live="polite">
                <p className={styles.label}>Its model is handed</p>
                <p className={styles.line}>
                    {rendering.pieces.map((piece, index) =>
                        piece.kind === 'tag' ? (
                            <span key={index} className={styles.tag}>
                                {piece.text}
                            </span>
                        ) : (
                            piece.text
                        ),
                    )}
                </p>
                <p className={styles.note}>
                    {rendering.stripped.length === 0
                        ? 'This build performs both cues, so each becomes its own tag.'
                        : `The core stripped ${rendering.stripped.map(cue => `[${cue}]`).join(' and ')} before dispatch, because this build does not claim ${rendering.stripped.length === 1 ? 'it' : 'them'}. The model never reads the word out loud.`}
                </p>
            </div>

            <figcaption className={styles.caption}>
                The standard vocabulary, <Link to="/docs/protocol#5-the-standard-vocabulary">protocol § 5</Link>.
            </figcaption>
        </figure>
    );
}
