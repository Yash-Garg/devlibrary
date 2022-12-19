/**
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as fs from "fs";
import fetch from "node-fetch";
import * as path from "path";
import sendgrid from "@sendgrid/mail";

import { BlogMetadata } from "../types/BlogMetadata";
import { RepoMetadata } from "../types/RepoMetadata";

import {
  addMediumBlog,
  addOtherBlog,
  addRepo,
  parseGithubUrl,
} from "./addproject";
import { getConfigDir } from "./util";

const ADVOCU_METADATA_FILE_NAME = "advocu.json";

// Advocu API Staging
// For usage, see:
// https://api-devlibrary-stage.k8s01.nexo.zone/swagger-ui/index.htm const
// API_HOST = "https://api-devlibrary-stage.k8s01.nexo.zone";

// Advodu API Prod
// For usage, see: https://api-devlibrary.advocu.com/swagger-ui/index.html
const API_HOST = "https://api-devlibrary.advocu.com";

// API path to get applications
const PATH_GET_APPLICATIONS = "/public/applications";

const SENDGRID_API_KEY = "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";

function exitWithError(msg: string, code = 1) {
  console.error(msg);
  process.exit(code);
}

type NonEmptyArray<T> = [T, ...T[]];

interface AdvocuMetadata {
  lastPullTime: number;
}

enum ApplicationStatus {
  SUBMITTED = "SUBMITTED",
  CONTENT_VERIFICATION_REJECTED = "CONTENT_VERIFICATION_REJECTED",
  CONTENT_VERIFICATION_APPROVED = "CONTENT_VERIFICATION_APPROVED",
}

interface Application {
  expertise: string;
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string;
  steps: {
    contentVerification: {
      status: "pending" | "approved";
      dates: {
        start: string | null;
        review: string | null;
        overdue: string | null;
      };
    };
  };
  productCategory: string;
  blogPost: { url: string; description: string } | null;
  github: {
    repositoryUrl: string;
    profileUrls: string[];
    projectName: string;
    licenseConfirmation: boolean;
    description: string;
    linkToReadme: string;
  } | null;
  tags: string[];
}

const sendAutomatedEmail = (email: string, firstName: string, lastName: string) => {
  sendgrid.setApiKey(SENDGRID_API_KEY)

  const text = "Dear " + firstName + ", Congratulations, your content has been published"
    + " on the Google Dev Library platform. You can view it in your Dev Library author profile"
    + "https://devlibrary.withgoogle.com/authors/" + firstName + lastName +
    " As next steps, you can also: Subscribe to our newsletter to stay updated with the latest"
    + "projects added to Dev Library. Join the Dev Library authors' channel Google Developers"
    + " Online Discord public server to connect with other Dev Library authors."
    + " Share your success on social media using the hashtag #GoogleDevLibrary"

  const html = `<p>Dear ${firstName},</p><br><p>Congratulations, your content has been publish on the <a href="http://devlibrary.withgoogle.com" target="_blank">Google Dev Library platform</a>. You can view it in your Dev Library author profile: https://devlibrary.withgoogle.com/authors/${firstName}${lastName}</p><br><p>As next steps, you can also:</p><br><ul><li><a href="https://forms.gle/chWDtT5sbxaE2knZ6" target="_blank">Subscribe</a> to our newsletter to stay updated with the latest projects added to Dev Library.</li><li><a href="https://discord.com/invite/AbwzvEqdCu" target="_blank">Join</a> the Dev Library authors’ channel Google Developers Online Discord public server to connect with other Dev Library authors.</li><li><b>Share your success</b> on social media using the hashtag #GoogleDevLibrary</li></ul><br><p>Happy contributing!</p><br><p>Regards,</p><p>Google Dev Library Team</p>`

  const finalEmail = {
    from: "library-google-dev@google.com",
    to: email,
    subject: "[Google Dev Library] Congratulations your content is live",
    text: text,
    html: html
  }

  sendgrid.send(finalEmail)
    .then((response) => {
      console.log('SendGrid Email sent: ' + response)
    })
    .catch((error) => {
      console.error(error)
    })
}

function assertNonEmpty<T>(arr: T[]): arr is NonEmptyArray<T> {
  return arr.length > 0;
}

function applicationToRepoMetadata(a: Application): RepoMetadata {
  if (!a.github) {
    throw new Error(`Application ${a.id} does not have 'github' field`);
  }

  if (!assertNonEmpty(a.tags)) {
    throw new Error(`Application ${a.id} has empty 'tags' field`);
  }

  const { owner, repo } = parseGithubUrl(a.github.repositoryUrl);

  return {
    owner,
    repo,
    name: a.github.projectName,
    shortDescription: a.github.description,
    longDescription: a.github.description,
    content: a.github.linkToReadme,
    tags: a.tags,
    expertise: a.expertise,// "INTERMEDIATE",
  };
}

function applicationToBlogMetadata(a: Application): BlogMetadata {
  if (!a.blogPost) {
    throw new Error(`Application ${a.id} does not have 'blogPost' field`);
  }

  if (!assertNonEmpty(a.tags)) {
    throw new Error(`Application ${a.id} has empty 'tags' field`);
  }

  return {
    author: `${a.firstName} ${a.lastName}`,
    title: a.blogPost.description,
    link: a.blogPost.url,
    tags: a.tags,
    expertise: a.expertise,//"INTERMEDIATE",
  };
}

export async function main() {
  const advocuToken = process.env.ADVOCU_TOKEN;
  if (!advocuToken) {
    exitWithError("Error: must set 'ADVOCU_TOKEN' environment variable");
  }

  const advocuMetadataPath = path.join(
    getConfigDir(),
    ADVOCU_METADATA_FILE_NAME
  );
  const advocuMetadata = JSON.parse(
    fs.readFileSync(advocuMetadataPath).toString()
  ) as AdvocuMetadata;

  const nowDate = new Date();
  const lastPullDate = new Date(advocuMetadata.lastPullTime);
  console.log(`Last pull: ${lastPullDate.toISOString()}`);

  const params = {
    status: ApplicationStatus.CONTENT_VERIFICATION_APPROVED,
    from: lastPullDate.toISOString(),
  };
  const encodedParams = Object.entries(params)
    .map((entry) => {
      return `${encodeURIComponent(entry[0])}=${encodeURIComponent(entry[1])}`;
    })
    .join("&");

  const url = `${API_HOST}${PATH_GET_APPLICATIONS}?${encodedParams}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${advocuToken}`,
    },
  });

  const applications = (await res.json()) as Application[];
  console.log(`New items: ${applications.length}`);

  // For each new application, add the project and the author files
  for (const a of applications) {
    console.log();
    const product = a.productCategory;

    if (a.github) {
      const projectUrl = a.github.repositoryUrl;
      const metadata = applicationToRepoMetadata(a);

      console.log(`Adding ${product} repo ${projectUrl}`);
      await addRepo(product, projectUrl, /* projectId= */ undefined, metadata);
      await sendAutomatedEmail(a.email, a.firstName, a.lastName);
    }

    if (a.blogPost) {
      const projectUrl = a.blogPost.url;
      const metadata = applicationToBlogMetadata(a);

      console.log(`Adding ${product} blog ${projectUrl}`);
      try {
        if (projectUrl.includes("medium.com")) {
          await addMediumBlog(
            product,
            projectUrl,
            /* projectId= */ undefined,
            metadata
          );
          await sendAutomatedEmail(a.email, a.firstName, a.lastName);
        } else {
          await addOtherBlog(
            product,
            projectUrl,
            /* projectId= */ undefined,
            metadata
          );
          await sendAutomatedEmail(a.email, a.firstName, a.lastName);
        }
      } catch (e) {
        console.error(`Problem occurred when adding a project: ${e}`);
        console.error(e);
      }
    }
  }

  // Update the advocu metadata file
  const newAdvocuMetadata: AdvocuMetadata = {
    lastPullTime: nowDate.getTime(),
  };
  fs.writeFileSync(
    advocuMetadataPath,
    JSON.stringify(newAdvocuMetadata, undefined, 2)
  );

  console.log();
  console.log(
    "Success! Please 'git commit' any changes and push the new config files."
  );
  console.log();
}

if (require.main === module) {
  main();
}
