import { YoutubeLoader } from "@langchain/community/document_loaders/web/youtube";
import { Ollama } from "@langchain/ollama";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";

export async function getResponseFromLangChain(youtube_url, question) {
	dotenv.config();

	/******** Load the document from the YouTube URL ********/
	const loader = YoutubeLoader.createFromUrl(youtube_url, {
		language: "en",
		addVideoInfo: true,
	});
	const docs = await loader.load();
	const fullText = docs.map((doc) => doc.pageContent).join("\n");
	const splitter = new RecursiveCharacterTextSplitter({
		chunkSize: 250, // Adjust chunk size as needed
		chunkOverlap: 50, // Overlap to maintain context between chunks
	});
	const chunks = await splitter.splitText(fullText);
	const records = chunks.map((chunk, index) => ({
		_id: `rec${index + 1}`,
		chunk_text: chunk,
	}));

	/******** Create a Pinecone index and upsert the records ********/
	const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
	const indexName =
		"langchain-" + new Date().getMinutes().toString().padStart(2, "0");
	await pc.createIndexForModel({
		name: indexName,
		cloud: "aws",
		region: "us-east-1",
		embed: {
			model: "llama-text-embed-v2",
			fieldMap: { text: "chunk_text" },
		},
		waitUntilReady: true,
	});
	const index = pc.index(indexName).namespace("example-namespace");
	await index.upsertRecords(records);
	//giving a liberal 20 seconds for the index to be ready
	await new Promise((resolve) => setTimeout(resolve, 20000));

	/******** Search for the relevant chunks from Pinecone DB ********/
	const stats = await index.describeIndexStats();
	console.log(stats);
	const rerankedResults = await index.searchRecords({
		query: {
			topK: 10,
			inputs: { text: question },
		},
	});

	// Print the reranked results this is for observing purposes
	/****
	rerankedResults.result.hits.forEach((hit) => {
		console.log(
			`id: ${hit._id}, score: ${hit._score.toFixed(2)}, text: ${
				hit.fields.chunk_text
			}`
		);
	});
	****/

	/******** Generate the LLM query and get response from LLM ********/
	let relevant_transcripts = rerankedResults.result.hits
		.map((hit) => (hit._score > 0.2 ? hit.fields.chunk_text : ""))
		.join("\n");

	let llm_query =
		"You are a helpful youtube assistant, your job is to answer the question on the video based on the video transcript provided below.your answer should be concise when possible.if the documents provided is not sufficient to answer the question, you can simply reply 'Cannot answer the question'.\nOnly use information from the transcript provided below to answer the question.\ndo not add in your pre trained information to answer the question.\n";
	llm_query +="\n\nTranscript: " + relevant_transcripts + "\nQuestion: " + question;
	const llm = new Ollama({
		model: "deepseek-r1:14b",
		temperature: 0,
		maxRetries: 2,
	});
	let response = await llm.invoke(llm_query);
	// Don't forget to clean up the index 😉
	pc.deleteIndex(indexName);
	response = response.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
	return response;
}
