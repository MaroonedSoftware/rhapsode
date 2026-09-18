import type { Check } from '@maroonedsoftware/johnny5';

/**
 * Informational, never a failure. `pcm` and `wav` are framed by the SDK and always work; `mp3`,
 * `opus` and `flac` need ffmpeg, and without it a worker simply reports fewer formats (see
 * docs/operating.md, "Formats"). Worth knowing before a `/speak` for mp3 is refused, not worth a red
 * doctor.
 */
export const ffmpeg: Check = {
    name: 'ffmpeg',
    run: async ctx => {
        const binary = ctx.env.RHAPSODE_FFMPEG ?? 'ffmpeg';
        try {
            const first = String((await ctx.shell.run(binary, ['-version'])).stdout).split('\n')[0] ?? '';
            return { ok: true, message: first.replace(/ Copyright.*$/, '') };
        } catch {
            return { ok: true, message: 'not found: pcm and wav only (mp3, opus and flac need ffmpeg)' };
        }
    },
};
