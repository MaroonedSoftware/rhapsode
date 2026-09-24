import Link from '@docusaurus/Link';
import { ENGINES } from '../engines';
import styles from './engine.table.module.css';

/** The catalog as a table, because it is one: the same six facts about each engine. */
export default function EngineTable() {
    return (
        <div className={styles.scroll}>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th scope="col">Engine</th>
                        <th scope="col">Runs on</th>
                        <th scope="col">Default weights</th>
                        <th scope="col" className={styles.num}>
                            Cues
                        </th>
                        <th scope="col">Voices</th>
                        <th scope="col">Licence: code / weights</th>
                    </tr>
                </thead>
                <tbody>
                    {ENGINES.map(engine => (
                        <tr key={engine.id}>
                            <th scope="row">
                                <Link to={`/docs/engines/${engine.id}`}>{engine.name}</Link>
                                <span className={styles.summary}>{engine.summary}</span>
                            </th>
                            <td>{engine.runsOn}</td>
                            <td>{engine.weights}</td>
                            <td className={`${styles.num} rh-num`}>{engine.cues} of 8</td>
                            <td>{engine.voices}</td>
                            <td>
                                {engine.license.code} / {engine.license.weights}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
