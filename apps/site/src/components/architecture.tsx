import styles from './architecture.module.css';

const CLIENTS = ['Your app', 'Any OpenAI client', 'The web page and the wizard'];

const WORKERS = [
    { name: 'kokoro', detail: 'its own venv, on a unix socket' },
    { name: 'chatterbox', detail: 'its own venv, on a unix socket' },
    { name: 'orpheus', detail: 'another machine, over TCP' },
];

/**
 * The README's diagram, drawn so it reflows: three columns side by side where there is room, and
 * a stack that reads top to bottom on a phone. A worker speaks the engine-scoped subset of the
 * public API, so every arrow is the same protocol.
 */
export default function Architecture() {
    return (
        <figure className={styles.diagram}>
            <ul className={styles.column} aria-label="Clients">
                {CLIENTS.map(client => (
                    <li key={client} className={styles.client}>
                        {client}
                    </li>
                ))}
            </ul>

            <div className={styles.link} aria-hidden="true">
                <span>HTTP</span>
            </div>

            <div className={styles.core}>
                <strong>The core</strong>
                <span>Routing, residency and encoding. It never imports torch.</span>
            </div>

            <div className={styles.link} aria-hidden="true">
                <span>the same API</span>
            </div>

            <ul className={styles.column} aria-label="Workers">
                {WORKERS.map(worker => (
                    <li key={worker.name} className={styles.worker}>
                        <strong>{worker.name}</strong>
                        <span>{worker.detail}</span>
                    </li>
                ))}
            </ul>

            <figcaption className={styles.caption}>
                Each engine is a worker process in its own virtualenv. A crash takes down that worker, not the server, and a worker on another machine
                is only a URL.
            </figcaption>
        </figure>
    );
}
