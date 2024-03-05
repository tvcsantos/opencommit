import axios from 'axios';
import chalk from 'chalk';
import {
  ChatCompletionRequestMessage,
  Configuration as OpenAiApiConfiguration,
  OpenAIApi
} from 'openai';

import { intro, outro } from '@clack/prompts';

import {
  CONFIG_MODES,
  DEFAULT_TOKEN_LIMITS,
  getConfig
} from '../commands/config';
import { GenerateCommitMessageErrorEnum } from '../generateCommitMessageFromGitDiff';
import { tokenCount } from '../utils/tokenCount';
import { AiEngine } from './Engine';

const config = getConfig();

const MAX_TOKENS_OUTPUT = config?.OCO_TOKENS_MAX_OUTPUT || DEFAULT_TOKEN_LIMITS.DEFAULT_MAX_TOKENS_OUTPUT;
const MAX_TOKENS_INPUT = config?.OCO_TOKENS_MAX_INPUT || DEFAULT_TOKEN_LIMITS.DEFAULT_MAX_TOKENS_INPUT;
const basePath = config?.OCO_OPENAI_BASE_PATH;
const apiKey = config?.OCO_OPENAI_API_KEY
const apiType = config?.OCO_OPENAI_API_TYPE || 'openai'
const azureApiVersion = config?.OCO_OPENAI_AZURE_API_VERSION

const [command, mode] = process.argv.slice(2);

const isLocalModel = config?.OCO_AI_PROVIDER == 'ollama'


if (!apiKey && command !== 'config' && mode !== CONFIG_MODES.set && !isLocalModel) {
  intro('opencommit');

  outro(
    'OCO_OPENAI_API_KEY is not set, please run `oco config set OCO_OPENAI_API_KEY=<your token> . If you are using GPT, make sure you add payment details, so API works.`'
  );
  outro(
    'For help look into README https://github.com/di-sukharev/opencommit#setup'
  );

  process.exit(1);
}

const MODEL = config?.OCO_MODEL || 'gpt-3.5-turbo';

class OpenAi implements AiEngine {
  private openAiApiConfiguration = new OpenAiApiConfiguration({
    apiKey: apiKey
  });
  private openAI!: OpenAIApi;

  constructor() {
    switch (apiType) {
      case 'azure':
        this.openAiApiConfiguration.baseOptions =  {
          headers: {
            'api-key': apiKey,
          },
          params: {
            'api-version': azureApiVersion,
          }
        };
        if (basePath) {
          this.openAiApiConfiguration.basePath = basePath + 'openai/deployments/' + MODEL;
        }
        break;
      case 'openai':
      default:
        if (basePath) {
          this.openAiApiConfiguration.basePath = basePath;
        }
        break;
    }
    this.openAI = new OpenAIApi(this.openAiApiConfiguration);
  }

  public generateCommitMessage = async (
    messages: Array<ChatCompletionRequestMessage>
  ): Promise<string | undefined> => {
    const params = {
      model: MODEL,
      messages,
      temperature: 0,
      top_p: 0.1,
      max_tokens: MAX_TOKENS_OUTPUT
    };
    try {
      const REQUEST_TOKENS = messages
        .map((msg) => tokenCount(msg.content) + 4)
        .reduce((a, b) => a + b, 0);

      if (REQUEST_TOKENS > MAX_TOKENS_INPUT - MAX_TOKENS_OUTPUT) {
        throw new Error(GenerateCommitMessageErrorEnum.tooMuchTokens);
      }

      const { data } = await this.openAI.createChatCompletion(params);

      const message = data.choices[0].message;

      return message?.content;
    } catch (error) {
      outro(`${chalk.red('✖')} ${JSON.stringify(params)}`);

      const err = error as Error;
      outro(`${chalk.red('✖')} ${err?.message || err}`);

      if (
        axios.isAxiosError<{ error?: { message: string } }>(error) &&
        error.response?.status === 401
      ) {
        const openAiError = error.response.data.error;

        if (openAiError?.message) outro(openAiError.message);
        outro(
          'For help look into README https://github.com/di-sukharev/opencommit#setup'
        );
      }

      throw err;
    }
  };
}



export const api = new OpenAi();
