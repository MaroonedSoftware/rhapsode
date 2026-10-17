import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './sample.module.css';

interface SampleProps {
    /** The file under `static/samples/`. */
    file: string;
    /** The engine, and the voice and build where they matter. */
    title: string;
    /** The request's text, cue tags and all, so a reader can hear what each tag did. */
    text: string;
}

/**
 * One recorded request: what was asked for, and what came back. `preload="none"` because a page of
 * eight players would otherwise fetch 1.6 MB before anybody pressed play.
 */
export default function Sample({ file, title, text }: SampleProps) {
    return (
        <figure className={styles.sample}>
            <figcaption className={styles.title}>{title}</figcaption>
            <audio className={styles.player} controls preload="none" src={useBaseUrl(`/samples/${file}`)} />
            <pre className={styles.text}>{text}</pre>
        </figure>
    );
}
