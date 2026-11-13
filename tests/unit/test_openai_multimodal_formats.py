# Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
# SPDX-License-Identifier: AGPL-3.0
"""Exercise the provider-specific payload through the real OpenAI SDK."""

import json
import math

import httpx
import pytest

from openviking.models.embedder.openai_embedders import OpenAIDenseEmbedder

IMAGE = "data:image/png;base64,cGljdHVyZQ=="
IMAGE_PART = {"type": "image_url", "image_url": {"url": IMAGE}}
TEXT_PART = {"type": "text", "text": "red square"}


def make_embedder(monkeypatch, handler, **kwargs):
    transport = httpx.MockTransport(handler)
    module = "openviking.models.embedder.openai_embedders"
    monkeypatch.setattr(
        f"{module}.create_optional_sync_httpx_client",
        lambda *args, **kw: httpx.Client(transport=transport),
    )
    monkeypatch.setattr(
        f"{module}.create_optional_async_httpx_client",
        lambda *args, **kw: httpx.AsyncClient(transport=transport),
    )
    options = {
        "model_name": "Qwen/Qwen3-VL-Embedding-8B",
        "api_base": "https://api.siliconflow.cn/v1",
        "api_key": "test-key",
        "dimension": 3,
        "input_type": "multimodal",
        "multimodal_input_format": "text_image",
        "encoding_format": "float",
    }
    options.update(kwargs)
    return OpenAIDenseEmbedder(**options)


def response(vectors):
    return httpx.Response(
        200,
        json={
            "object": "list",
            "data": [
                {"object": "embedding", "index": i, "embedding": vector}
                for i, vector in enumerate(vectors)
            ],
            "usage": {"prompt_tokens": 2, "total_tokens": 2},
        },
    )


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize(
    "content,expected_input,vectors,expected_vector",
    [
        ("red square", "red square", [[1, 0, 0]], [1, 0, 0]),
        ([IMAGE_PART], [{"image": IMAGE}], [[0, 1, 0]], [0, 1, 0]),
        (
            [TEXT_PART, IMAGE_PART],
            [{"text": "red square"}, {"image": IMAGE}],
            [[1, 0, 0], [0, 1, 0]],
            [1 / math.sqrt(2), 1 / math.sqrt(2), 0],
        ),
        (
            [IMAGE_PART, IMAGE_PART],
            [{"image": IMAGE}, {"image": IMAGE}],
            [[0, 1, 0], [0, 0, 1]],
            [0, 1 / math.sqrt(2), 1 / math.sqrt(2)],
        ),
    ],
)
async def test_text_image_wire_format_and_pooling(
    monkeypatch, asynchronous, content, expected_input, vectors, expected_vector
):
    def handler(request):
        assert request.url.path == "/v1/embeddings"
        assert request.headers["authorization"] == "Bearer test-key"
        assert json.loads(request.content) == {
            "model": "Qwen/Qwen3-VL-Embedding-8B",
            "input": expected_input,
            "encoding_format": "float",
        }
        return response(vectors)

    embedder = make_embedder(monkeypatch, handler)
    try:
        result = (
            await embedder.embed_async(content, is_query=True)
            if asynchronous
            else embedder.embed(content, is_query=True)
        )
        assert result.dense_vector == pytest.approx(expected_vector)
    finally:
        embedder.close()


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize(
    "options,content,expected_input",
    [
        ({"input_type": "text"}, [TEXT_PART, IMAGE_PART], "red square"),
        ({"api_base": "https://api.siliconflow.com/v1"}, [IMAGE_PART], [{"image": IMAGE}]),
        ({"api_base": "https://other-provider.example/v1"}, [IMAGE_PART], [{"image": IMAGE}]),
        ({"multimodal_input_format": "openai"}, [IMAGE_PART], [IMAGE_PART]),
        ({"model_name": "other-vl-embedding"}, [IMAGE_PART], [{"image": IMAGE}]),
        ({}, ["red", "square"], ["red", "square"]),
    ],
)
async def test_conversion_preserves_other_providers_models_modes_and_text_batches(
    monkeypatch, asynchronous, options, content, expected_input
):
    def handler(request):
        assert json.loads(request.content)["input"] == expected_input
        return response([[1, 0, 0]])

    embedder = make_embedder(monkeypatch, handler, **options)
    try:
        result = await embedder.embed_async(content) if asynchronous else embedder.embed(content)
        assert result.dense_vector == [1, 0, 0]
    finally:
        embedder.close()


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize(
    "vectors,message",
    [
        ([], "unexpected number"),
        ([[1, 0, 0], [0, 1]], "inconsistent embedding dimensions"),
        ([[0, 0, 0], [0, 0, 0]], "zero pooled embedding"),
    ],
)
async def test_multimodal_response_cannot_silently_drop_a_content_embedding(
    monkeypatch, asynchronous, vectors, message
):
    embedder = make_embedder(monkeypatch, lambda request: response(vectors))
    try:
        with pytest.raises(RuntimeError, match=message):
            if asynchronous:
                await embedder.embed_async([TEXT_PART, IMAGE_PART])
            else:
                embedder.embed([TEXT_PART, IMAGE_PART])
    finally:
        embedder.close()


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("wire_format", ["openai", "text_image"])
async def test_provider_fused_response_is_preserved(monkeypatch, asynchronous, wire_format):
    embedder = make_embedder(
        monkeypatch,
        lambda request: response([[0.25, 0.5, 0.75]]),
        multimodal_input_format=wire_format,
    )
    try:
        content = [TEXT_PART, IMAGE_PART]
        result = await embedder.embed_async(content) if asynchronous else embedder.embed(content)
        assert result.dense_vector == [0.25, 0.5, 0.75]
    finally:
        embedder.close()


async def test_typed_content_response_includes_every_vector(monkeypatch):
    embedder = make_embedder(
        monkeypatch,
        lambda request: response([[1, 0, 0], [0, 1, 0]]),
        multimodal_input_format="openai",
    )
    try:
        result = await embedder.embed_async([TEXT_PART, IMAGE_PART])
        assert result.dense_vector == pytest.approx([1 / math.sqrt(2), 1 / math.sqrt(2), 0])
    finally:
        embedder.close()


async def test_failover_uses_each_endpoints_wire_format(monkeypatch):
    from openviking_cli.utils.config.embedding_config import EmbeddingConfig

    calls = []

    def handler(request):
        calls.append(request.url.host)
        payload = json.loads(request.content)
        if request.url.host == "primary.example":
            assert payload["input"] == [IMAGE_PART]
            return httpx.Response(503, json={"error": {"message": "temporarily unavailable"}})
        assert payload["input"] == [{"image": IMAGE}]
        return response([[0, 1, 0]])

    # Install the real SDK transports before the config factory creates clients.
    setup = make_embedder(monkeypatch, handler)
    setup.close()
    config = EmbeddingConfig(
        dense={
            "provider": "openai",
            "model": "any-vl-embedding",
            "dimension": 3,
            "input": "multimodal",
            "multimodal_input_format": "text_image",
            "encoding_format": "float",
            "credentials": [
                {
                    "id": "primary",
                    "api_base": "https://primary.example/v1",
                    "api_key": "test-key",
                    "multimodal_input_format": "openai",
                },
                {
                    "id": "backup",
                    "api_base": "https://backup.example/v1",
                    "api_key": "test-key",
                },
            ],
        },
        max_retries=0,
    )
    embedder = config.get_embedder()
    try:
        result = await embedder.embed_async([IMAGE_PART])
        assert result.dense_vector == [0, 1, 0]
        assert calls == ["primary.example", "backup.example"]
    finally:
        embedder.close()


@pytest.mark.parametrize("wire_format", ["openai", "text_image"])
async def test_azure_uses_the_selected_wire_format(monkeypatch, wire_format):
    def handler(request):
        expected = [IMAGE_PART] if wire_format == "openai" else [{"image": IMAGE}]
        assert json.loads(request.content)["input"] == expected
        return response([[0, 1, 0]])

    embedder = make_embedder(
        monkeypatch, handler, provider="azure", multimodal_input_format=wire_format
    )
    try:
        assert (await embedder.embed_async([IMAGE_PART])).dense_vector == [0, 1, 0]
    finally:
        embedder.close()


def test_account_binding_does_not_inherit_another_endpoints_format():
    from openviking.config.vector import resolve_effective_embedding
    from openviking_cli.utils.config.embedding_config import EmbeddingConfig

    cluster = EmbeddingConfig(
        dense={
            "provider": "openai",
            "model": "same-vector-space",
            "api_key": "cluster-key",
            "dimension": 3,
            "input": "multimodal",
            "multimodal_input_format": "text_image",
        }
    )
    effective = resolve_effective_embedding(
        cluster,
        {
            "dense": {
                "model": "same-vector-space",
                "dimension": 3,
                "input": "multimodal",
                "credentials": [{"provider": "openai", "api_key": "account-key"}],
            }
        },
    )
    assert effective.dense.multimodal_input_format == "openai"
