"""Aislamiento por tenant de la base de conocimiento de voz (workspace ElevenLabs compartido)."""
from __future__ import annotations

import copy

import pytest
from fastapi import HTTPException
from sqlmodel import select

from app.models.User import UserRole
from app.models.UserAgent import UserAgent
from app.models.UserKnowledgeBaseDocument import UserKnowledgeBaseDocument


class FakeElevenLabs:
    def __init__(self):
        self.calls: list[dict] = []
        self.routes: dict[tuple[str, str], object] = {}

    async def __call__(self, method, path, *, json=None, params=None, data=None, files=None):
        self.calls.append(
            {"method": method, "path": path, "json": copy.deepcopy(json), "params": params}
        )
        handler = self.routes.get((method, path))
        if handler is None:
            raise HTTPException(status_code=404, detail=f"no route {method} {path}")
        if callable(handler):
            return handler(json=json, params=params)
        return copy.deepcopy(handler)

    def called(self, method, path) -> bool:
        return any(c["method"] == method and c["path"] == path for c in self.calls)


@pytest.fixture
def el(monkeypatch):
    fake = FakeElevenLabs()
    monkeypatch.setattr("app.controllers.AgentController._elevenlabs_request", fake)
    return fake


def _kb_pages(*, params, json=None):
    # Dos paginas para verificar que se sigue el cursor.
    if (params or {}).get("cursor") == "page2":
        return {"documents": [{"id": "docLegacy"}, {"id": "docOther"}], "has_more": False}
    return {
        "documents": [{"id": "docA"}, {"id": "docB"}],
        "has_more": True,
        "next_cursor": "page2",
    }


@pytest.fixture
def kb_setup(client, db, make_user, headers_for, el):
    user_a = make_user("a@example.com")
    user_b = make_user("b@example.com")
    admin = make_user("admin@example.com", role=UserRole.SUPER_ADMIN)

    db.add(UserAgent(user_id=user_a.id, agent_id="agentA"))
    db.commit()

    el.routes[("POST", "/convai/knowledge-base/text")] = lambda json, params: {
        "id": json["name"],
        "name": json["name"],
    }
    el.routes[("GET", "/convai/knowledge-base")] = _kb_pages
    el.routes[("GET", "/convai/agents/agentA")] = {
        "agent_id": "agentA",
        "conversation_config": {
            "agent": {"prompt": {"knowledge_base": [{"id": "docLegacy", "name": "Legacy"}]}}
        },
    }
    for doc_id in ("docA", "docB", "docLegacy", "docOther"):
        el.routes[("DELETE", f"/convai/knowledge-base/{doc_id}")] = {}
        el.routes[("PATCH", f"/convai/knowledge-base/{doc_id}")] = {"id": doc_id}
        el.routes[("GET", f"/convai/knowledge-base/{doc_id}/rag-index")] = {"indexes": []}

    res = client.post(
        "/api/agents/knowledge-base/text",
        json={"text": "a", "name": "docA"},
        headers=headers_for(user_a),
    )
    assert res.status_code == 200, res.text
    res = client.post(
        "/api/agents/knowledge-base/text",
        json={"text": "b", "name": "docB"},
        headers=headers_for(user_b),
    )
    assert res.status_code == 200, res.text
    return {"a": user_a, "b": user_b, "admin": admin}


def _listed_ids(client, headers) -> set[str]:
    res = client.get("/api/agents/knowledge-base", headers=headers)
    assert res.status_code == 200, res.text
    return {doc["id"] for doc in res.json()["documents"]}


def test_create_records_ownership(kb_setup, db):
    rows = db.exec(select(UserKnowledgeBaseDocument)).all()
    owners = {row.documentation_id: row.user_id for row in rows}
    assert owners == {"docA": kb_setup["a"].id, "docB": kb_setup["b"].id}


def test_list_is_filtered_per_tenant_and_follows_cursor(client, kb_setup, headers_for):
    # A: su documento + el legacy que usa su agente. B: solo el suyo.
    assert _listed_ids(client, headers_for(kb_setup["a"])) == {"docA", "docLegacy"}
    assert _listed_ids(client, headers_for(kb_setup["b"])) == {"docB"}
    assert _listed_ids(client, headers_for(kb_setup["admin"])) == {
        "docA",
        "docB",
        "docLegacy",
        "docOther",
    }


def test_user_cannot_touch_other_tenant_documents(client, kb_setup, headers_for, el):
    headers_b = headers_for(kb_setup["b"])

    assert client.delete("/api/agents/knowledge-base/docA", headers=headers_b).status_code == 404
    assert (
        client.patch(
            "/api/agents/knowledge-base/docA", json={"name": "x"}, headers=headers_b
        ).status_code
        == 404
    )
    assert (
        client.get("/api/agents/knowledge-base/docA/rag-index", headers=headers_b).status_code
        == 404
    )
    assert (
        client.post(
            "/api/agents/knowledge-base/docA/rag-index",
            json={"model": "e5_mistral_7b_instruct"},
            headers=headers_b,
        ).status_code
        == 404
    )
    assert not el.called("DELETE", "/convai/knowledge-base/docA")
    assert not el.called("PATCH", "/convai/knowledge-base/docA")


def test_legacy_document_attached_to_own_agent_is_readable_not_deletable(
    client, kb_setup, headers_for, el
):
    headers_a = headers_for(kb_setup["a"])
    res = client.get("/api/agents/knowledge-base/docLegacy/rag-index", headers=headers_a)
    assert res.status_code == 200, res.text

    assert client.delete("/api/agents/knowledge-base/docLegacy", headers=headers_a).status_code == 404
    assert not el.called("DELETE", "/convai/knowledge-base/docLegacy")


def test_owner_and_super_admin_can_delete(client, kb_setup, headers_for, db, el):
    res = client.delete("/api/agents/knowledge-base/docA", headers=headers_for(kb_setup["a"]))
    assert res.status_code == 200, res.text
    assert el.called("DELETE", "/convai/knowledge-base/docA")
    remaining = {row.documentation_id for row in db.exec(select(UserKnowledgeBaseDocument)).all()}
    assert remaining == {"docB"}

    res = client.delete(
        "/api/agents/knowledge-base/docOther", headers=headers_for(kb_setup["admin"])
    )
    assert res.status_code == 200, res.text
