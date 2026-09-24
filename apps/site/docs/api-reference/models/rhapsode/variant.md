---
title: "Variant"
sidebar_position: 2
mdx:
    format: "md"
---

> What one build of an engine can perform. Capabilities depend on which build is loaded, which is
> the whole reason this document has two levels: chatterbox `turbo` performs the paralinguistic
> tags and discards the dials, while `original` is the other way round.

<details>
<summary>Attributes (9)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `cues` | `string[]` | Yes | A subset of the standard vocabulary, § 5. |
| `deliveries` | `string[]` | Yes | Ditto. Not an enum: § 9 forbids failing on an unknown one. |
| `dials` | `Record<string, Dial>` | Yes | Engine-specific numbers, named by the adapter. |
| `languages` | `string[]` | No |  |
| `maxCharacters` | `number` | No | Overrides the engine's own ceiling for this build. |
| `cloning` | `Cloning` | No | Optional only because contract 1 shipped without it. § 4. |
| `blending` | `Blending` | No | Beside cloning, for the same reason: it needs no model. § 7. |
| `segmentation` | `Segmentation` | No | Whether long text is split into several generations. § 8. |
| `dialogue` | `Dialogue` | No | Present only where this build answers /dialogue. § 6. |

</details>
