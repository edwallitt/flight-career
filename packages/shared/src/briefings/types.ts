export interface ClientVoice {
  dispatcherName: string;
  personalityPrompt: string;
  sampleNote: string;
}

export interface BriefingContent {
  cargoDescription: string;
  dispatcherNote: string;
  recipientNote: string | null;
  handlingNotes: string[];
  generatedAt: number;
}
