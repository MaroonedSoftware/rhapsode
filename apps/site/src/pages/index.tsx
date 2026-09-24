import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

export default function Home() {
    return (
        <Layout description="A multi-engine speech server: one contract, many TTS models.">
            <main className="container margin-vert--xl">
                <h1>rhapsode</h1>
                <p>A multi-engine speech server: one contract, many TTS models.</p>
                <Link to="/docs/quick-start">Quick start</Link>
            </main>
        </Layout>
    );
}
