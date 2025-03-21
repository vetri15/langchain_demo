import { run } from "@backroad/backroad";
import { getResponseFromLangChain } from "./langchain_helper.js";

run((br) => {
	const llm_response = br.getOrDefault("response", null);
	br.write({
		body: "# Youtube Assistant #",
	});
	const youtube_url = br.textInput({
		label: "paste youtube link here 👇👇👇",
		placeholder: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
	});
    const question = br.textInput({
		label: "ask your question relating to the video",
		placeholder: "what does the video tell about....",
	});

	// const num = br.numberInput({
	// 	defaultValue: 5,
	// 	step: 2,
	// 	label: "Choose a Number",
	// });

	if (llm_response) {
		br.write({
			body: llm_response,
		});
	}

	const submit = br.button({ label: "Submit", id: "submit" });
	if (submit && youtube_url && question) {
		console.log("Hi");
		getResponseFromLangChain(youtube_url, question).then((response) => {
			br.setValue("response", response);
		});
	}
});
