# Third-party notices — DSH Desktop helper stack

This file records copyright and license facts for optional helper components
the desktop shell may use. The default NSIS installer does **not** ship model
weights or an inference binary; operators stage them separately when choosing
**Local small model** at install time.

## Spark-X2.5 model weights (optional, operator-supplied)

- **Project:** Spark-X2.5 (词元星火 / XHToken, iFlytek subsidiary)
- **Example repos:** https://huggingface.co/collections/XHToken/spark-x25
- **License:** Apache License 2.0
- **Copyright:** Copyright 2026 XHToken (see each Hugging Face `LICENSE`)
- **Redistribution:** Apache-2.0 permits commercial use and redistribution of
  the Work and Derivative Works when you include the License text, preserve
  notices, and (if present) NOTICE attributions. Fine-tuning under Apache-2.0
  does not require publishing your fine-tuned weights, but you must still
  comply with §§4(a)–(d) if you redistribute the original or modified Work.
- **Trademarks:** Apache-2.0 does not grant trademark rights in “讯飞”,
  “星火”, “XHToken”, or related marks; do not imply endorsement.

This product does not claim ownership of Spark-X2.5. If you later bundle a
Spark checkpoint in a custom installer, ship a copy of its Apache-2.0 LICENSE
(and NOTICE if any) beside the weights.

## llama.cpp / llama-server (optional, operator-supplied)

- **Project:** https://github.com/ggml-org/llama.cpp
- **License:** MIT License
- **Copyright:** Copyright (c) 2023–2026 The ggml authors
- **Requirement when redistributing the binary:** keep the MIT copyright
  notice and permission text with all copies or substantial portions of the
  Software.

Model weights loaded by llama.cpp are **not** covered by the MIT grant; each
checkpoint keeps its own license (e.g. Spark-X2.5 Apache-2.0 above).

## DeepSeek cloud helpers (install mode = Online API)

Cloud helper calls use the DeepSeek API under the operator’s own API key and
DeepSeek’s then-current terms of service. No third-party model weights are
redistributed for this mode.

## DSH Desktop itself

Application code in this repository remains under the repository’s own
license terms. This notices file does not change those terms.
