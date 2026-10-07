# text-embeddings-inference con el modelo incluido en la imagen: no se descarga en runtime.
ARG TEI_IMAGE=ghcr.io/huggingface/text-embeddings-inference:cpu-1.5
ARG PY_IMAGE=python:3.12-slim

FROM ${PY_IMAGE} AS model
ARG MODEL_ID=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
# Revisión fijada (commit del repo en Hugging Face) para builds reproducibles.
# TEI en CPU sirve este modelo (XLM-R) con el backend ONNX: se descargan los pesos onnx/model.onnx.
ARG MODEL_REVISION=e8f8c211226b894fcb81acc59f3b34ba3efd5f42
# El secret `ca` es opcional: solo para builds detrás de un proxy con CA propio.
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export PIP_CERT=/run/secrets/ca; fi; \
    pip install --no-cache-dir "huggingface_hub==0.26.2"
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export REQUESTS_CA_BUNDLE=/run/secrets/ca; fi; \
    python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='${MODEL_ID}', revision='${MODEL_REVISION}', local_dir='/model', allow_patterns=['config.json','onnx/model.onnx','tokenizer.json','tokenizer_config.json','special_tokens_map.json','modules.json','sentence_bert_config.json','config_sentence_transformers.json','1_Pooling/*'])" \
    && rm -rf /model/.cache && ls -la /model

FROM ${TEI_IMAGE}
COPY --from=model /model /model
ENV HF_HUB_OFFLINE=1
CMD ["--model-id", "/model", "--max-client-batch-size", "64", "--max-batch-tokens", "8192"]
