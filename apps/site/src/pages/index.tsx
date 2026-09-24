import Link from '@docusaurus/Link';
import CodeBlock from '@theme/CodeBlock';
import Layout from '@theme/Layout';
import Architecture from '../components/architecture';
import CueDemo from '../components/cue.demo';
import EngineTable from '../components/engine.table';
import styles from './index.module.css';

// The README's example, abridged: the fields a client reads to decide what to offer.
const CAPABILITIES = `GET /engines/chatterbox/capabilities

{
  "contract": 1,
  "license": {
    "code": "MIT",
    "weights": "MIT",
    "weightsCommercialUse": true
  },
  "current": {
    "variant": "turbo",
    "cues": ["laugh", "chuckle", "sigh", "gasp",
             "cough", "clear throat", "sniff", "groan"],
    "deliveries": [],
    "dials": {},
    "cloning": { "supported": true }
  },
  "variants": {
    "turbo": {
      "cues": ["laugh", "..."],
      "dials": {}
    },
    "original": {
      "cues": [],
      "dials": { "exaggeration": {}, "cfgWeight": {} }
    }
  }
}`;

const DOCKER = `curl -fsSLO https://raw.githubusercontent.com/MaroonedSoftware/rhapsode/main/compose.yaml
docker compose up -d`;

const SPEAK = `curl -X POST localhost:8080/speak \\
  -H 'content-type: application/json' \\
  -d '{"engine":"kokoro","text":"Right, that was The Verve Pipe.","format":"wav"}' \\
  --output line.wav`;

/**
 * What deadair.radio asks of speech, which is why rhapsode exists, and the part of rhapsode that
 * answers each. The needs are deadair's own, from its "Models and voices" page.
 */
const NEEDS = [
    {
        need: 'Many voices, on more than one engine',
        answer: 'A host, a newsreader and every character, each on whichever engine suits it. One API speaks them all, and each voice names its engine.',
    },
    {
        need: 'A presenter who laughs, and a caller who clears their throat',
        answer: 'Cues ride in the text. The station offers only the cues the loaded engine reports, and the core strips the rest, so nobody reads “laugh” out loud on air.',
    },
    {
        need: 'One graphics card, shared with a language model',
        answer: 'The core decides what is on the card, gives the memory back when a keep-alive runs out, and unloads an engine now when asked.',
    },
    {
        need: 'Never silence',
        answer: 'Every engine runs in its own process, so a crash takes down that worker and not the server, and a failure is reported instead of arriving as a short, silent file.',
    },
];

/** The three kinds of project the README says exist, and the one this is. */
const KINDS = [
    {
        name: 'Single-model wrappers',
        text: 'A web UI on one model family. You end up using somebody else’s UI backend as infrastructure.',
    },
    {
        name: 'UI-first suites',
        text: 'Twenty engines, and the API is a tab that starts a second server. Every engine it reaches shares one Python environment.',
    },
    {
        name: 'API-first servers',
        text: 'Well built, and they stop at the easy engines: no voice cloning, and no GPU to share between models.',
    },
];

export default function Home() {
    return (
        <Layout description="A self-hosted, multi-engine speech server: one contract, many TTS models.">
            <main className={styles.page}>
                <section className={styles.hero}>
                    <div className={styles.heroCopy}>
                        <h1 className={styles.headline}>One contract, many TTS models.</h1>
                        <p className={styles.lede}>
                            rhapsode is a speech server you run yourself. Install the engines you want, and every client talks to one HTTP API that
                            says honestly what each engine can do. Ollama, but for speech.
                        </p>
                        <div className={styles.actions}>
                            <Link className={styles.primary} to="/docs/quick-start">
                                Quick start
                            </Link>
                            <Link className={styles.secondary} to="/docs/protocol">
                                Read the protocol
                            </Link>
                        </div>
                        <p className={styles.small}>
                            MIT licensed. One Docker image for amd64 and arm64, with or without a GPU. A rhapsode was a performer who recited written
                            verse aloud, which is the job description.
                        </p>
                    </div>
                    <CueDemo />
                </section>

                <section className={styles.split}>
                    <div className={styles.prose}>
                        <h2>Every engine says what it can do, for the build it has loaded</h2>
                        <p>
                            A client asks <code>GET /engines/{'{engine}'}/capabilities</code> and gets back which cues, deliveries and dials the
                            engine performs, which languages, and how it clones. Everything a client offers comes from that document, so a new engine
                            works in it with no change.
                        </p>
                        <p>
                            <strong>It depends on the build.</strong> Chatterbox’s <code>turbo</code> performs cues and has no dials, and{' '}
                            <code>original</code> is the other way round. So the document says what is loaded now, under <code>current</code>, and
                            what every build could do, under <code>variants</code>. A flat list would let a client send dials that vanish without a
                            word.
                        </p>
                        <p>
                            <strong>The licence names code and weights separately.</strong> Apache-2.0 code over research-only weights is common, and
                            the weights are what decide whether you may ship. The catalog shows both before you install anything.
                        </p>
                        <p>
                            <Link to="/docs/protocol#4-the-capability-document">The capability document, protocol § 4</Link>
                        </p>
                    </div>
                    <CodeBlock language="json" className={styles.code}>
                        {CAPABILITIES}
                    </CodeBlock>
                </section>

                <section className={styles.section}>
                    <h2>Why another speech server</h2>
                    <p className={styles.sectionLede}>
                        rhapsode started as the speech layer for <a href="https://deadair.radio">deadair.radio</a>, a radio station whose hosts are
                        synthesized. A station asks of speech what any product built on it does, only all at once.
                    </p>
                    <dl className={styles.needs}>
                        {NEEDS.map(item => (
                            <div key={item.need} className={styles.need}>
                                <dt>{item.need}</dt>
                                <dd>{item.answer}</dd>
                            </div>
                        ))}
                    </dl>
                    <p className={styles.sectionLede}>
                        Looking for a server that did all four turned up three kinds of project, and none of them was it.
                    </p>
                    <dl className={styles.kinds}>
                        {KINDS.map(kind => (
                            <div key={kind.name} className={styles.kind}>
                                <dt>{kind.name}</dt>
                                <dd>{kind.text}</dd>
                            </div>
                        ))}
                        <div className={`${styles.kind} ${styles.ours}`}>
                            <dt>rhapsode</dt>
                            <dd>
                                Headless, multi-engine and contract-first, with every engine in its own process and a residency manager that knows a
                                GPU holds one model at a time.
                            </dd>
                        </div>
                    </dl>
                </section>

                <section className={styles.section}>
                    <h2>How it works</h2>
                    <p className={styles.sectionLede}>
                        A worker speaks the engine-scoped part of the public API. There is no second protocol, so an engine author tests a worker with
                        curl and never needs the core.
                    </p>
                    <Architecture />
                </section>

                <section className={styles.section}>
                    <h2>The engines</h2>
                    <p className={styles.sectionLede}>
                        Each is a Python package with its own licences, installed through the API into a virtualenv of its own. Text to speech only:
                        speech to text is a different problem, and <Link to="/docs/protocol#13-deliberately-not-in-v1">deliberately not here</Link>.
                    </p>
                    <EngineTable />
                </section>

                <section className={styles.split}>
                    <div className={styles.prose}>
                        <h2>Run it</h2>
                        <p>
                            With Docker there is nothing to clone. The image serves the API on port 8080 and a web page for installing engines on
                            8081, and keeps engines and their weights in a volume.
                        </p>
                        <p>
                            Install Kokoro from the page and it speaks on the CPU, from a download of about 200 MB. With an NVIDIA card, add{' '}
                            <code>compose.gpu.yaml</code> and try Chatterbox.
                        </p>
                        <p>
                            The <Link to="/docs/quick-start">quick start</Link> has the rest, and <Link to="/docs/operating">running one</Link> has
                            what the server keeps where, GPUs and upgrades.
                        </p>
                    </div>
                    <div className={styles.stack}>
                        <CodeBlock language="bash" title="Start it">
                            {DOCKER}
                        </CodeBlock>
                        <CodeBlock language="bash" title="Say something">
                            {SPEAK}
                        </CodeBlock>
                    </div>
                </section>

                <section className={styles.section}>
                    <h2>Build on it</h2>
                    <ul className={styles.routes}>
                        <li>
                            <h3>
                                <Link to="/docs/develop">Add an engine</Link>
                            </h3>
                            <p>
                                Subclass one Python class. The SDK handles the socket, the handshake, the errors, encoding and long text, and{' '}
                                <code>rhapsode-conform</code> tells you whether your worker is one.
                            </p>
                        </li>
                        <li>
                            <h3>
                                <Link to="/docs/api-reference">Call the API</Link>
                            </h3>
                            <p>
                                Every route, generated from the same contracts as the server, with a typed TypeScript client that depends on nothing.
                            </p>
                        </li>
                        <li>
                            <h3>
                                <Link to="/docs/openai">Point an OpenAI client at it</Link>
                            </h3>
                            <p>
                                <code>/v1/audio/speech</code> answers with the model naming an engine. What an engine cannot do is refused, never
                                quietly dropped.
                            </p>
                        </li>
                    </ul>
                </section>
            </main>
        </Layout>
    );
}
