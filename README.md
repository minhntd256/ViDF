# ViDF

**ViDF** is a multimodal video fact-checking system designed to identify, localize, and analyze misinformation in user-generated and short-form videos.
It integrates **video understanding**, **claim-level analysis**, **multimodal consistency checking**, and **evidence retrieval** into an interactive verification workflow.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Project Structure](#project-structure)
3. [Getting Started](#getting-started)

   * [Backend](#backend)
   * [Frontend](#frontend)
4. [Demo Video](#demo-video)
5. [License](#license)
6. [Contact](#contact)

---

## Project Overview

ViDF goes beyond conventional binary video-level misinformation detection by providing fine-grained analysis of **what is misleading, where it occurs, and what evidence supports the verification result**.

The system provides:

* **Multimodal video analysis** combining visual, textual, and temporal information.
* **Claim extraction and analysis** from video transcripts and associated content.
* **Fine-grained misinformation localization** at the claim, scene, or frame level.
* **Multimodal consistency analysis** to identify inconsistencies between spoken claims and visual content.
* **Temporal editing analysis** to identify potentially misleading temporal arrangements or contextual manipulations.
* **Evidence retrieval** from external web sources to support the verification of factual claims.
* **Interactive verification interface** for exploring claims, findings, evidence, and their corresponding video segments.
* **Progressive presentation of analysis results**, allowing users to inspect verification findings without being overwhelmed by low-level details.

ViDF is designed to support researchers and practitioners in **fine-grained multimodal misinformation analysis and video fact-checking**.

---

## Project Structure

```text
.
├── backend/         # Backend services for video processing, analysis, evidence retrieval, and APIs
├── webapp/   # Web-based interface for interactive video verification and visualization
├── LICENSE
└── README.md        # This file
```

* **`backend/`** – Handles video processing, transcript and claim analysis, multimodal reasoning, evidence retrieval, and REST API services.
* **`webapp/`** – Provides the interactive interface for inspecting video content, claims, verification findings, and supporting evidence.

---

## Getting Started


For detailed instructions on installation, configuration, and running the system, see the [backend README](backend/README.md).

---

## Demo Video

▶️ Watch the ViDF demo: [Demo Video](https://youtu.be/a0cSEDQbxV0)

---
## Demo Web

The ViDF web interface is designed to be deployed and run locally following the instructions provided in [Getting Started](#getting-started).
Since the online demo is not continuously hosted, if you would like to access a live demo, please contact the authors.

---
## License

This project is distributed under the **MIT License**. See the [LICENSE](LICENSE) file for details.

---

## Contact

For questions or feedback, please contact:

📧 **Nguyen Tran Duy Minh** – [ntdminh@jaist.ac.jp](mailto:ntdminh@jaist.ac.jp)

✨ **Project Website:** [ViDF Project Website](https://www.jaist.ac.jp/)
