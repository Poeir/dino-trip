def clean_json_string(json_str: str) -> str:
    """Strip the ```json ... ``` fences the KKU gateway sometimes wraps JSON
    responses in even when response_format={"type": "json_object"} is set.
    Shared by both the itinerary generator and the judge, which hit the same
    gateway quirk."""
    if json_str is None:
        # Observed live: the gateway occasionally returns a null message
        # content (e.g. a filtered/empty completion) instead of a string.
        # Both callers already retry on any exception here -- raise with a
        # clear cause instead of the ambiguous 'NoneType' object has no
        # attribute 'strip' the bare .strip() below would otherwise produce.
        raise ValueError("LLM response content was empty (None)")
    json_str = json_str.strip()
    if json_str.startswith("```json"):
        json_str = json_str[7:]
    elif json_str.startswith("```"):
        json_str = json_str[3:]
    if json_str.endswith("```"):
        json_str = json_str[:-3]
    return json_str.strip()
