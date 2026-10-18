import os

import openai
import requests

openai.api_key = os.environ["OPENAI_API_KEY"]


def ask(prompt):
    # Legacy interface from openai-python < 1.0
    return openai.ChatCompletion.create(
        model="gpt-3.5-turbo",
        messages=[{"role": "user", "content": prompt}],
    )


def legacy_charge(customer):
    return requests.post("https://api.stripe.com/v1/charges", data={"customer": customer})
