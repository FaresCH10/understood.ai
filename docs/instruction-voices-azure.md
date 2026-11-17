# Activate multilingual instruction voices

The `groq-azure` mode keeps Groq Orpheus for English/Arabic and routes the other
worker languages to Azure Speech. It uses the existing private worker audio
endpoints for the instruction and question with its frozen answer choices.

## Azure setup

1. Sign in at https://portal.azure.com/ and create a **Speech** resource.
2. Select your subscription, resource group, region and pricing tier. Check the
   selected tier's allowance and charges in Azure before creating the resource.
3. Open the resource's **Keys and Endpoint**. Copy a key and its region privately.
4. In Vercel, open **understood-ai → Settings → Environment Variables**. Set these
   for **Production**, marking the key sensitive:

   ```text
   AZURE_SPEECH_KEY=<your resource key>
   AZURE_SPEECH_REGION=<region identifier, for example eastus>
   UNDERSTOOD_VERCEL_INSTRUCTION_SPEECH=groq-azure
   ```

5. Keep the existing `GROQ_API_KEY`, `NVIDIA_API_KEY`, `DEEPL_API_KEY`,
   `UNDERSTOOD_INSTRUCTION_TEXT_PROVIDER=nemotron` and private storage settings.
6. Redeploy **understood-ai**. The operator app needs no change.

Do not commit keys or paste them into chats. To check locally, create the ignored
`.env.voices.local` with the key and region, then run:

```powershell
node --env-file=.env.voices.local scripts/check-azure-instruction-voices.mjs
```

This lists missing configured voices using Azure's voice-list API. It doesn't
upload instruction text or generate billable narration. A successful voice-list
check is configuration evidence, not a pronunciation test.

## Language handling

- DeepL remains the translator for its supported worker locales.
- Sinhala and Shahmukhi Punjabi use Nemotron translation with an independent
  meaning/language check. A failed check blocks publication.
- Shahmukhi text stays visible in Shahmukhi. For narration only, Nemotron converts
  a copy to Gurmukhi Punjabi; a second check must pass before Azure receives it.
  Native Punjabi listening review is still needed for dialect and pronunciation.
- Acknowledgments use a translated fixed receipt prompt, without quiz generation.
- Audio is limited to 90 seconds per track and 1,000 input characters. Longer
  translated tracks can fail these limits; shorten the instruction if needed.
- Without either Azure setting, the new mode continues with Groq's English and
  Arabic. A partially configured Azure resource is an explicit configuration
  error. Unsupported languages are not advertised as available.
- This adapter extends the existing Vercel credential runtime. It does not
  change the separate approved production tier's admission requirements.

## Verification before rollout

Automated tests use synthetic provider responses. After configuring the resource,
send a short synthetic instruction to a test worker in each language. Check the
instruction, question and all choices; check acknowledgment-only delivery too.
Ask native speakers to review Sinhala, Nepali and both Punjabi scripts before
relying on their pronunciation. No live Azure synthesis was verified while the
resource credentials were absent.

Rollback: set `UNDERSTOOD_VERCEL_INSTRUCTION_SPEECH=groq` and redeploy.

References: [Azure Speech REST API](https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech),
[voice coverage](https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts).
