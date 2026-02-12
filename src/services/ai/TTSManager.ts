import { TTSProvider, TTSOptions } from './TTSInterface';
import { azureTTSService } from './AzureTTSService';

export class TTSManager {
    private providers: Map<string, TTSProvider> = new Map();
    private currentProviderId: string = 'azure';

    constructor() {
        this.registerProvider(azureTTSService);
    }

    registerProvider(provider: TTSProvider) {
        this.providers.set(provider.id, provider);
    }

    setCurrentProvider(id: string) {
        if (this.providers.has(id)) {
            this.currentProviderId = id;
        } else {
            throw new Error(`Provider ${id} not found`);
        }
    }

    getCurrentProvider(): TTSProvider {
        const provider = this.providers.get(this.currentProviderId);
        if (!provider) {
            throw new Error(`Current provider ${this.currentProviderId} not found`);
        }
        return provider;
    }

    async getVoice(text: string, options?: TTSOptions): Promise<ArrayBuffer> {
        return this.getCurrentProvider().getVoice(text, options);
    }

    async getVoiceList(): Promise<any> {
        return this.getCurrentProvider().getVoiceList();
    }

    getAvailableProviders(): { id: string, name: string }[] {
        return Array.from(this.providers.values()).map(p => ({
            id: p.id,
            name: p.name
        }));
    }
}

export const ttsManager = new TTSManager();
