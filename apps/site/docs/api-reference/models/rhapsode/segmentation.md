---
title: "Segmentation"
sidebar_position: 6
mdx:
    format: "md"
---

> Whether text longer than one generation is split rather than refused. protocol.md § 8.
> 
> Declared because a client cannot see the split and is affected by it: a `seed` reproduces a
> generation, so a request split four ways is four seeded generations, and prosody carries across a
> joint only where the engine carries it.

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `supported` | `boolean` | Yes |  |
| `segmentCharacters` | `number` | No | The most one generation gets. Absent where nothing splits. |

</details>
