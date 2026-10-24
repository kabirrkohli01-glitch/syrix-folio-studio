// Benchmark passages for the humanizer. Written for this benchmark; they cover
// different registers and contain the problems the pipeline should fix
// (stock phrases, stacked transitions, real spelling errors, filler, uniform
// rhythm) alongside details it must preserve (numbers, names, quotations,
// citations, links, technical terms).

export const PASSAGES = [
  {
    id: 'academic',
    label: 'Academic paragraph with citations',
    must: ['Liang et al. (2023)', '61.3%', '91', 'TOEFL', '"neither accurate nor reliable"', '(Weber-Wulff et al., 2023)'],
    text: `In the modern era, AI detection tools play a crucial role in academic integrity processes. Furthermore, it is important to note that these tools are not always reliable. Liang et al. (2023) found that detectors misclassified 61.3% of 91 TOEFL essays written by non-native speakers as AI-generated. Moreover, a broader review described the tools as "neither accurate nor reliable" (Weber-Wulff et al., 2023). Additionally, institutions must navigate the complexities of using such tools fairly.

It is essential to recognise that a detector score is a probability rather than proof. Consequently, universities should use these scores as one input among many. Ultimately, human judgement remains essential in any decision about misconduct.`,
  },
  {
    id: 'technical',
    label: 'Technical explanation',
    must: ['TCP', 'UDP', '3-way handshake', '20 bytes', 'RFC 9293', 'port 443'],
    text: `TCP is a connection-oriented protocol that utilizes a 3-way handshake to establish a reliable connection between two hosts. The TCP header is a minimum of 20 bytes in size and contains fields such as sequence numbers and acknowledgement numbers. TCP is specified in RFC 9293. UDP is a connectionless protocol that does not establish a connection before sending data. UDP is faster than TCP because it has less overhead. UDP is commonly used for streaming and gaming.

HTTPS traffic normally uses port 443 and runs over TCP. In order to ensure that data arrives in the correct order, TCP leverages sequence numbers in a robust and seamless manner.`,
  },
  {
    id: 'email',
    label: 'Business email',
    must: ['Friday 14 November', '£2,400', 'Priya', 'version 3'],
    text: `Dear Priya,

I hope this email finds you well. I am writing to inform you that we have received your proposal and we would like to take this opportunity to thank you for it. At this point in time, we are not in a position to approve the full budget of £2,400. However, we would be delighted to discuss a reduced scope.

Please could you send us version 3 of the plan by Friday 14 November? Please do not hesitate to contact me should you have any questions.

Kind regards,
Sam`,
  },
  {
    id: 'reflective',
    label: 'Student reflection with errors and filler',
    must: ['Photoshop', 'peer review', 'Design 2', 'GIF'],
    errors: ['could of', 'alot', 'definately', 'should of', 'dose not', 'and all', 'you know', 'basically'],
    text: `In this evaluation I am going to look at my banner and be honest about what worked and what did not and what I could of done differently and all. The peer review helped alot because my peer said Design 2 was basically too busy, you know, so I simplified it in Photoshop.

The GIF loops correctly but it dose not look as sharp as I wanted. I definately should of tested it on a phone screen earlier because the text was to small and that was a pretty big problem really.`,
  },
  {
    id: 'narrative',
    label: 'Narrative with uniform rhythm',
    must: ['Marcus', 'Leeds', '6.40 a.m.', 'platform 4'],
    text: `Marcus arrived at Leeds station at 6.40 a.m. on a cold Tuesday morning. He walked slowly towards platform 4 with his heavy bag. He noticed that the departure board was showing a delay. He decided to buy a coffee from the small kiosk nearby. He sat down on a bench and waited patiently for the train. He thought about the interview that was waiting for him in London.`,
  },
];

// Writing samples for a profile benchmark: a relaxed, direct first-person
// voice with short sentences, contractions, "really", "a lot" and dashes.
export const PROFILE_SAMPLES = [
  { title: 'Sample A', text: `I didn't expect the first week to be this busy. There's a lot to take in — new people, new timetable, new everything. But honestly it's been fine. The lectures are long, sometimes really long, and I've already learned to bring snacks. My plan for next week is simple: get to bed earlier and stop leaving reading until Sunday night. It never works out when I do that. I know that, and I still do it.

The best part so far has been the labs. You actually get to build things instead of just hearing about them. We made a small web page on Tuesday and it broke three times before it worked. That's the fun of it, I think. You break it, you fix it, you understand it a bit better.` },
  { title: 'Sample B', text: `Football training was cancelled again, which was annoying. The pitch was flooded — properly flooded, not just a few puddles. So I went to the gym instead and did an hour on the bike. It's not the same, but it's something. I've got a match on Saturday and I want to feel ready.

My coach says I rush my passes. He's right. I see the gap and I go for it before I've looked properly. This week I'm going to slow down a bit and pick my moment. It sounds easy. It isn't. When the game's moving fast you just react, and reacting is exactly the habit I need to break.` },
  { title: 'Sample C', text: `I tried cooking a proper meal for the first time this term. Nothing fancy — pasta, a sauce from scratch, some garlic bread. It took me ages. The recipe said twenty minutes and it took nearly an hour, mostly because I kept checking things I didn't need to check. Still, it tasted good, really good actually, and it cost a lot less than takeaway.

Next time I'll prep everything first. Chop the onions, measure the pasta, get the pans out. That's the trick people kept telling me about and I ignored it. I won't ignore it again. Cooking's a lot calmer when you're not hunting for a spoon while something burns.` },
];
